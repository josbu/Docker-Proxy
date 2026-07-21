package main

import (
	"crypto/tls"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"net/url"
	"regexp"
	"strings"
	"sync"
	"time"
)

// Path patterns for the Docker Registry HTTP API V2.
var (
	manifestRe  = regexp.MustCompile(`^/v2/(.+)/manifests/([^/]+)$`)
	blobRe      = regexp.MustCompile(`^/v2/(.+)/blobs/([^/]+)$`)
	tagsRe      = regexp.MustCompile(`^/v2/(.+)/tags/list$`)
	referrersRe = regexp.MustCompile(`^/v2/(.+)/referrers/([^/]+)$`)
)

type tokenEntry struct {
	token     string
	expiresAt time.Time
}

// Proxy is the registry reverse proxy. It forwards Registry API V2 requests to
// the configured upstream, performing server-side bearer-token authentication so
// that clients behind restrictive networks never talk to the upstream auth server
// directly. Blobs and manifests are streamed back without being stored locally.
type Proxy struct {
	cfg        *Config
	hostIndex  map[string]*RegistryConfig
	defaultReg *RegistryConfig
	routeMux   sync.RWMutex

	clients   map[string]*http.Client
	clientMux sync.Mutex

	tokenCache map[string]tokenEntry
	cacheMux   sync.Mutex
}

// buildRoutes computes the Host->registry index and the default registry from cfg.
// Registries whose Enabled is explicitly false are skipped.
func buildRoutes(cfg *Config) (map[string]*RegistryConfig, *RegistryConfig) {
	idx := make(map[string]*RegistryConfig)
	var def *RegistryConfig
	for i := range cfg.Registries {
		r := &cfg.Registries[i]
		if r.Enabled != nil && !*r.Enabled {
			continue // disabled via UI
		}
		for _, h := range r.Hosts {
			idx[strings.ToLower(h)] = r
		}
		if r.Name == cfg.Default {
			def = r
		}
	}
	if def == nil && len(cfg.Registries) > 0 {
		def = &cfg.Registries[0]
	}
	return idx, def
}

func NewProxy(cfg *Config) *Proxy {
	p := &Proxy{
		cfg:        cfg,
		hostIndex:  make(map[string]*RegistryConfig),
		clients:    make(map[string]*http.Client),
		tokenCache: make(map[string]tokenEntry),
	}
	idx, def := buildRoutes(cfg)
	p.hostIndex = idx
	p.defaultReg = def
	return p
}

// reload swaps in a new configuration without dropping in-flight requests.
// It makes a heap copy of cfg first so we never retain the caller's (possibly
// stack-allocated) memory — storing a pointer to a local variable would become
// dangling once the caller returns and its stack frame is reused.
func (p *Proxy) reload(cfg *Config) {
	cp := new(Config)
	*cp = *cfg
	regs := make([]RegistryConfig, len(cfg.Registries))
	for i := range cfg.Registries {
		regs[i] = cfg.Registries[i] // string fields are heap-allocated and safe to share
	}
	cp.Registries = regs

	idx, def := buildRoutes(cp)
	p.routeMux.Lock()
	p.hostIndex = idx
	p.defaultReg = def
	p.cfg = cp
	p.routeMux.Unlock()
	// Drop cached upstream tokens; they may no longer be valid for the new routes.
	p.cacheMux.Lock()
	p.tokenCache = make(map[string]tokenEntry)
	p.cacheMux.Unlock()
}

// resolveRegistry picks an upstream based on the request Host (or X-Forwarded-Host
// when running behind a reverse proxy such as nginx/Caddy).
func (p *Proxy) resolveRegistry(r *http.Request) *RegistryConfig {
	host := strings.ToLower(strings.SplitN(r.Host, ":", 2)[0])
	p.routeMux.RLock()
	if reg, ok := p.hostIndex[host]; ok {
		p.routeMux.RUnlock()
		return reg
	}
	if fwd := r.Header.Get("X-Forwarded-Host"); fwd != "" {
		fh := strings.ToLower(strings.SplitN(fwd, ":", 2)[0])
		if reg, ok := p.hostIndex[fh]; ok {
			p.routeMux.RUnlock()
			return reg
		}
	}
	def := p.defaultReg
	p.routeMux.RUnlock()
	return def
}

func (p *Proxy) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	reg := p.resolveRegistry(r)
	if reg == nil {
		http.Error(w, "no upstream registry configured", http.StatusBadGateway)
		return
	}

	// API version check. We answer 200 directly so the docker client proceeds;
	// actual pulls go through server-side token authentication below.
	if r.URL.Path == "/v2/" || r.URL.Path == "/v2" {
		w.Header().Set("Docker-Distribution-Api-Version", "registry/2.0")
		w.WriteHeader(http.StatusOK)
		return
	}

	// We only proxy read operations. Push operations are not supported by a
	// pull-through proxy and would fail upstream anyway.
	switch r.Method {
	case http.MethodGet, http.MethodHead, http.MethodOptions:
	default:
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}

	start := time.Now()
	p.proxyRequest(w, r, reg)
	p.maybeLog(r, reg, start)
}

// logLevel returns the configured log verbosity: "quiet", "normal" (default), or "debug".
func (p *Proxy) logLevel() string {
	p.routeMux.RLock()
	lv := p.cfg.LogLevel
	p.routeMux.RUnlock()
	switch lv {
	case "quiet", "debug", "normal":
		return lv
	default:
		return "normal"
	}
}

// maybeLog emits a per-request access line, throttled by the configured log level.
//   - quiet:  nothing (errors are still logged at their source)
//   - normal: skip high-volume blob transfers, keep manifests/tags/referrers
//   - debug:  log every request (original behaviour)
func (p *Proxy) maybeLog(r *http.Request, reg *RegistryConfig, start time.Time) {
	switch p.logLevel() {
	case "quiet":
		return
	case "normal":
		// Blobs make up the bulk of transfer log noise; drop them by default.
		if blobRe.MatchString(r.URL.Path) {
			return
		}
	}
	log.Printf("%s %s -> %s (%s)", r.Method, r.URL.Path, reg.Name, time.Since(start))
}

func (p *Proxy) proxyRequest(w http.ResponseWriter, r *http.Request, reg *RegistryConfig) {
	client := p.getClient(reg)

	target, err := url.Parse(reg.Upstream)
	if err != nil {
		log.Printf("[ERR] bad upstream url %q: %v", reg.Upstream, err)
		http.Error(w, "bad upstream url", http.StatusBadGateway)
		return
	}
	target.Path = singleJoiningSlash(target.Path, r.URL.Path)
	target.RawQuery = r.URL.RawQuery

	repo := extractRepo(r.URL.Path)
	scope := ""
	if repo != "" {
		scope = "repository:" + repo + ":pull"
	}

	resp, err := p.doUpstream(client, r, target.String(), "")
	if err != nil {
		log.Printf("[ERR] upstream %s: %v", reg.Name, err)
		http.Error(w, "upstream error: "+err.Error(), http.StatusBadGateway)
		return
	}

	// Token challenge: upstream rejected us with 401. Obtain a bearer token and retry.
	if resp.StatusCode == http.StatusUnauthorized && reg.Auth.Type != AuthAnonymous {
		challenge := resp.Header.Get("WWW-Authenticate")
		realm, service, _ := parseBearerChallenge(challenge)
		resp.Body.Close()
		if realm != "" {
			token, terr := p.getToken(client, realm, service, scope, reg)
			if terr != nil {
				log.Printf("[ERR] token %s scope=%q: %v", reg.Name, scope, terr)
				http.Error(w, "token error: "+terr.Error(), http.StatusBadGateway)
				return
			}
			if token != "" {
				resp2, rerr := p.doUpstream(client, r, target.String(), token)
				if rerr != nil {
					log.Printf("[ERR] upstream %s (retry): %v", reg.Name, rerr)
					http.Error(w, "upstream error: "+rerr.Error(), http.StatusBadGateway)
					return
				}
				resp = resp2
			}
		}
	}

	defer resp.Body.Close()
	copyHeaders(w.Header(), resp.Header)
	// Drop the upstream auth challenge so the client does not try to reach the
	// upstream auth server directly (it may be unreachable from the client).
	w.Header().Del("WWW-Authenticate")
	w.Header().Set("Docker-Distribution-Api-Version", "registry/2.0")
	w.WriteHeader(resp.StatusCode)

	if r.Method == http.MethodHead {
		return
	}

	// Stream the body back without buffering it in memory or on disk.
	buf := make([]byte, 32*1024)
	flusher, _ := w.(http.Flusher)
	for {
		n, rerr := resp.Body.Read(buf)
		if n > 0 {
			if _, werr := w.Write(buf[:n]); werr != nil {
				return
			}
			if flusher != nil {
				flusher.Flush()
			}
		}
		if rerr == io.EOF {
			break
		}
		if rerr != nil {
			return
		}
	}
}

// doUpstream issues a request to the upstream. When token != "" it is sent as a
// Bearer Authorization header (used after the 401 challenge retry).
func (p *Proxy) doUpstream(client *http.Client, r *http.Request, targetURL, token string) (*http.Response, error) {
	req, err := http.NewRequest(r.Method, targetURL, nil)
	if err != nil {
		return nil, err
	}
	copyHeaders(req.Header, r.Header)
	// We manage authentication ourselves; never forward the client's credentials.
	req.Header.Del("Authorization")
	removeHopByHop(req.Header)
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}
	return client.Do(req)
}

func (p *Proxy) getClient(reg *RegistryConfig) *http.Client {
	p.clientMux.Lock()
	defer p.clientMux.Unlock()
	if c, ok := p.clients[reg.Name]; ok {
		return c
	}
	transport := &http.Transport{
		Proxy: http.ProxyFromEnvironment,
	}
	if reg.InsecureSkipVerify {
		transport.TLSClientConfig = &tls.Config{InsecureSkipVerify: true}
	}
	c := &http.Client{Transport: transport}
	p.clients[reg.Name] = c
	return c
}

// getToken fetches (and caches) a bearer token from the upstream auth realm.
func (p *Proxy) getToken(client *http.Client, realm, service, scope string, reg *RegistryConfig) (string, error) {
	key := realm + "|" + service + "|" + scope

	p.cacheMux.Lock()
	if e, ok := p.tokenCache[key]; ok && time.Now().Before(e.expiresAt) {
		tok := e.token
		p.cacheMux.Unlock()
		return tok, nil
	}
	p.cacheMux.Unlock()

	u, err := url.Parse(realm)
	if err != nil {
		return "", err
	}
	q := u.Query()
	if service != "" {
		q.Set("service", service)
	}
	if scope != "" {
		q.Set("scope", scope)
	}
	u.RawQuery = q.Encode()

	req, err := http.NewRequest(http.MethodGet, u.String(), nil)
	if err != nil {
		return "", err
	}
	if reg.Auth.Type == AuthBasic && (reg.Auth.Username != "" || reg.Auth.Password != "") {
		req.SetBasicAuth(reg.Auth.Username, reg.Auth.Password)
	} else if reg.Auth.Username != "" || reg.Auth.Password != "" {
		// Provide credentials to the token endpoint to lift rate limits (Docker Hub).
		req.SetBasicAuth(reg.Auth.Username, reg.Auth.Password)
	}

	resp, err := client.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(io.LimitReader(resp.Body, 512))
		return "", fmt.Errorf("token endpoint returned %d: %s", resp.StatusCode, string(body))
	}

	var tr struct {
		Token       string `json:"token"`
		AccessToken string `json:"access_token"`
		ExpiresIn   int    `json:"expires_in"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&tr); err != nil {
		return "", err
	}
	tok := tr.Token
	if tok == "" {
		tok = tr.AccessToken
	}
	if tok == "" {
		return "", fmt.Errorf("no token in response")
	}

	ttl := tr.ExpiresIn
	if ttl <= 0 {
		ttl = reg.TokenCacheTTL
	}
	if ttl <= 0 {
		ttl = 3600
	}
	expiresAt := time.Now().Add(time.Duration(ttl-30) * time.Second)
	p.cacheMux.Lock()
	p.tokenCache[key] = tokenEntry{token: tok, expiresAt: expiresAt}
	p.cacheMux.Unlock()
	return tok, nil
}

// extractRepo returns the repository name from a Registry V2 path, or "" if the
// path does not reference a repository (e.g. the /v2/ ping).
func extractRepo(path string) string {
	for _, re := range []*regexp.Regexp{manifestRe, blobRe, tagsRe, referrersRe} {
		if m := re.FindStringSubmatch(path); m != nil {
			return m[1]
		}
	}
	return ""
}

// parseBearerChallenge parses a WWW-Authenticate: Bearer realm="...",service="...",scope="..." header.
func parseBearerChallenge(header string) (realm, service, scope string) {
	header = strings.TrimSpace(header)
	if len(header) < 7 || !strings.EqualFold(header[:7], "bearer ") {
		return
	}
	rest := header[7:]
	var key, val strings.Builder
	inQuote := false
	expectVal := false
	commit := func() {
		k := strings.TrimSpace(key.String())
		v := strings.TrimSpace(val.String())
		switch strings.ToLower(k) {
		case "realm":
			realm = v
		case "service":
			service = v
		case "scope":
			scope = v
		}
		key.Reset()
		val.Reset()
		expectVal = false
	}
	for i := 0; i < len(rest); i++ {
		c := rest[i]
		if inQuote {
			if c == '"' {
				inQuote = false
			} else {
				val.WriteByte(c)
			}
			continue
		}
		switch c {
		case '"':
			inQuote = true
		case '=':
			expectVal = true
		case ',':
			if expectVal {
				commit()
			} else {
				key.WriteByte(c)
			}
		default:
			if expectVal {
				val.WriteByte(c)
			} else {
				key.WriteByte(c)
			}
		}
	}
	if expectVal {
		commit()
	}
	return
}

var hopHeaders = []string{
	"Connection", "Proxy-Connection", "Keep-Alive", "Proxy-Authenticate",
	"Proxy-Authorization", "Te", "Trailer", "Transfer-Encoding", "Upgrade",
}

func removeHopByHop(h http.Header) {
	for _, k := range hopHeaders {
		h.Del(k)
	}
	if c := h.Get("Connection"); c != "" {
		for _, f := range strings.Split(c, ",") {
			h.Del(strings.TrimSpace(f))
		}
	}
}

func copyHeaders(dst, src http.Header) {
	for k, vals := range src {
		for _, v := range vals {
			dst.Add(k, v)
		}
	}
}

func singleJoiningSlash(a, b string) string {
	aslash := strings.HasSuffix(a, "/")
	bslash := strings.HasPrefix(b, "/")
	switch {
	case aslash && bslash:
		return a + b[1:]
	case !aslash && !bslash:
		return a + "/" + b
	}
	return a + b
}
