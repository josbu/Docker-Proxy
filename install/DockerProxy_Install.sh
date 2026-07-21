#!/usr/bin/env bash
#===============================================================================
#
#          FILE: DockerProxy_Install.sh
#
#         USAGE: ./DockerProxy_Install.sh
#
#   DESCRIPTION: 基于 Go 纯代理 (go-proxy) 的一键部署脚本。
#                部署 Docker Hub / GHCR / Quay / K8s / MCR / Elastic / NVCR 等
#                公共镜像加速代理(零本地磁盘缓存)，并附带 hubcmdui 网页管理面板，
#                可在网页上直接增删改代理、设置服务器参数、热重载。
#                可选 Nginx / Caddy 反代，把各注册表子域转发到代理。
#
#  ORGANIZATION: DingQz dqzboy.com 浅时光博客
#===============================================================================

cat << 'LOGO'

    ██████╗  ██████╗  ██████╗██╗  ██╗███████╗██████╗     ██████╗ ██████╗  ██████╗ ██╗  ██╗██╗   ██╗
    ██╔══██╗██╔═══██╗██╔════╝██║ ██╔╝██╔════╝██╔══██╗    ██╔══██╗██╔══██╗██╔═══██╗╚██╗██╔╝╚██╗ ██╔╝
    ██║  ██║██║   ██║██║     █████╔╝ █████╗  ██████╔╝    ██████╔╝██████╔╝██║   ██║ ╚███╔╝  ╚████╔╝
    ██║  ██║██║   ██║██║     ██╔═██╗ ██╔══╝  ██╔══██╗    ██╔═══╝ ██╔══██╗██║   ██║ ██╔██╗   ╚██╔╝
    ██████╔╝╚██████╔╝╚██████╗██║  ██╗███████╗██║  ██║    ██║     ██║  ██║╚██████╔╝██╔╝ ██╗   ██║
    ╚═════╝  ╚═════╝  ╚═════╝╚═╝  ╚═╝╚══════╝╚═╝  ╚═╝    ╚═╝     ╚═╝  ╚═╝ ╚═════╝ ╚═╝  ╚═╝   ╚═╝

                        项目地址: https://github.com/dqzboy/Docker-Proxy

LOGO

GREEN="\033[0;32m"
RED="\033[31m"
YELLOW="\033[33m"
RESET="\033[0m"
BLUE="\033[0;34m"
CYAN="\033[0;36m"
LIGHT_GREEN="\033[1;32m"
LIGHT_RED="\033[1;31m"
LIGHT_YELLOW="\033[1;33m"
BOLD="\033[1m"
UNDERLINE="\033[4m"

INFO()  { echo -e "${GREEN}[INFO]${RESET} $*"; }
ERROR() { echo -e "${RED}[ERROR]${RESET} $*"; }
WARN()  { echo -e "${YELLOW}[WARN]${RESET} $*"; }
SEPARATOR() { echo "---------------------------------------------------------------"; }

PROMPT_YES_NO="(y/n)"

# ----------------------------- 路径 -----------------------------
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROXY_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
# 反代/构建配置在仓库中的原始下载地址（仓库默认分支 main），用于本地缺失时回退下载
RAW_BASE="https://raw.githubusercontent.com/dqzboy/Docker-Proxy/main"

# 在仓库内(有源码) -> 使用构建版 compose 并 --build；
# 单独下载脚本运行时 -> 使用镜像版 compose（直接拉取 dqzboy/* 镜像，不构建）。
if [ -f "$PROXY_DIR/docker-compose-build.yaml" ]; then
    COMPOSE_FILE="docker-compose-build.yaml"
    BUILD_FLAG="--build"
else
    COMPOSE_FILE="docker-compose.yaml"
    BUILD_FLAG=""
fi
COMPOSE_PATH="$PROXY_DIR/$COMPOSE_FILE"

ENV_FILE="$PROXY_DIR/.env"
NGINX_TPL="$PROXY_DIR/config/nginx/registry-proxy-go.conf"
CADDY_TPL="$PROXY_DIR/config/caddy/Caddyfile"
GO_PROXY_CONFIG="$PROXY_DIR/config/go-proxy/config.yaml"
GO_PROXY_CONFIG_EXAMPLE="$PROXY_DIR/go-proxy/config.yaml"
RENDER_DIR="/etc/docker-proxy"

# ----------------------------- 全局状态 -----------------------------
OS_ID=""
PKG_MANAGER=""
DOCKER_COMPOSE_CMD=""
PROXY_DOMAIN=""
PROXY_CHOICE=""   # nginx | caddy | none

# ===================================================================
# 环境检测
# ===================================================================
CHECK_ROOT() {
    if [ "$(id -u)" -ne 0 ]; then
        ERROR "请使用 ${LIGHT_RED}root${RESET} 用户运行本脚本 (sudo -i 或 sudo bash $0)"
        exit 1
    fi
}

CHECK_OS() {
    if [ -f /etc/os-release ]; then
        . /etc/os-release
        OS_ID="$ID"
    else
        OS_ID="$(uname -s)"
    fi
    INFO "检测到系统: ${LIGHT_GREEN}$OS_ID${RESET}"
}

CHECK_PKG_MANAGER() {
    if command -v apt-get >/dev/null 2>&1; then
        PKG_MANAGER="apt"
    elif command -v yum >/dev/null 2>&1; then
        PKG_MANAGER="yum"
    elif command -v dnf >/dev/null 2>&1; then
        PKG_MANAGER="dnf"
    elif command -v apk >/dev/null 2>&1; then
        PKG_MANAGER="apk"
    else
        WARN "未识别到包管理器，部分自动安装功能可能不可用"
    fi
}

PKG_INSTALL() {
    case "$PKG_MANAGER" in
        apt)  apt-get update >/dev/null 2>&1; apt-get install -y "$@" ;;
        yum)  yum install -y "$@" ;;
        dnf)  dnf install -y "$@" ;;
        apk)  apk add --no-cache "$@" ;;
        *)    ERROR "不支持的包管理器，请手动安装: $*"; return 1 ;;
    esac
}

CHECK_DOCKER() {
    if command -v docker >/dev/null 2>&1; then
        INFO "Docker 已安装: ${LIGHT_GREEN}$(docker --version)${RESET}"
        return 0
    fi
    return 1
}

CHECK_COMPOSE() {
    if docker compose version >/dev/null 2>&1; then
        DOCKER_COMPOSE_CMD="docker compose"
        INFO "Docker Compose (plugin) 已就绪"
        return 0
    elif command -v docker-compose >/dev/null 2>&1; then
        DOCKER_COMPOSE_CMD="docker-compose"
        INFO "Docker Compose (standalone) 已就绪"
        return 0
    fi
    return 1
}

OPEN_PORTS() {
    local ports="$1"
    if command -v ufw >/dev/null 2>&1 && ufw status >/dev/null 2>&1; then
        for p in $ports; do ufw allow "$p"/tcp >/dev/null 2>&1 && INFO "防火墙(ufw)已放行端口 $p"; done
    elif command -v firewall-cmd >/dev/null 2>&1; then
        for p in $ports; do firewall-cmd --permanent --add-port="$p"/tcp >/dev/null 2>&1; done
        firewall-cmd --reload >/dev/null 2>&1 && INFO "防火墙(firewalld)已放行端口 $ports"
    else
        WARN "未检测到 ufw/firewalld，请手动放行端口: $ports"
    fi
}

# ===================================================================
# 安装 Docker / Compose
# ===================================================================
INSTALL_DOCKER() {
    if CHECK_DOCKER; then
        if ! CHECK_COMPOSE; then
            INSTALL_COMPOSE
        fi
        return 0
    fi

    while true; do
        read -e -p "$(INFO "安装 Docker 镜像源 [${LIGHT_GREEN}1=国外${RESET} ${LIGHT_YELLOW}2=国内(加速)${RESET}] > ")" src
        case "$src" in
            1)
                INFO "使用官方源安装 Docker ..."
                curl -fsSL https://get.docker.com | sh
                break ;;
            2)
                INFO "使用国内镜像源安装 Docker ..."
                curl -fsSL https://get.docker.com | bash -s -- --mirror Aliyun
                break ;;
            *) INFO "请输入 ${LIGHT_GREEN}1${RESET} 或 ${LIGHT_YELLOW}2${RESET}" ;;
        esac
    done

    systemctl enable --now docker >/dev/null 2>&1 || service docker start >/dev/null 2>&1
    if ! CHECK_DOCKER; then
        ERROR "Docker 安装失败，请检查网络后重试"
        exit 1
    fi
    INFO "Docker 安装完成: ${LIGHT_GREEN}$(docker --version)${RESET}"

    if ! CHECK_COMPOSE; then
        INSTALL_COMPOSE
    fi
}

INSTALL_COMPOSE() {
    INFO "尝试安装 Docker Compose ..."
    if [ "$PKG_MANAGER" = "apt" ]; then
        PKG_INSTALL docker-compose-plugin >/dev/null 2>&1 && INFO "已安装 docker-compose-plugin" && return 0
    fi
    # 兜底：下载 standalone 版本
    local ver="v2.27.0"
    curl -fsSL "https://github.com/docker/compose/releases/download/${ver}/docker-compose-$(uname -s)-$(uname -m)" \
        -o /usr/local/bin/docker-compose 2>/dev/null \
        && chmod +x /usr/local/bin/docker-compose \
        && INFO "已安装 docker-compose standalone" && return 0
    WARN "Compose 安装失败，请手动安装后重试"
}

# ===================================================================
# 反代配置
# ===================================================================
# 取得反代配置文件：本地仓库存在则直接用，否则从仓库原始地址下载到本地。
ensure_template() {
    local rel="$1" local_path="$PROXY_DIR/$rel" url="$RAW_BASE/$rel"
    if [ -f "$local_path" ]; then
        echo "$local_path"
        return 0
    fi
    mkdir -p "$(dirname "$local_path")"
    INFO "本地未找到 $rel，尝试从 $url 下载 ..."
    if curl -fsSL "$url" -o "$local_path"; then
        INFO "已下载 $rel 到 $local_path"
        echo "$local_path"
        return 0
    fi
    ERROR "下载失败: $url （请确认网络，或手动把 $rel 放到 $PROXY_DIR 后重跑）"
    exit 1
}

ASK_DOMAIN() {
    while true; do
        read -e -p "$(INFO "请输入你的域名(用于子域反代, 如 docker.your.com, 需已解析到本机) > ")" PROXY_DOMAIN
        if [ -n "$PROXY_DOMAIN" ]; then
            break
        else
            WARN "域名不能为空"
        fi
    done
}

RENDER_NGINX() {
    local domain="$1"
    local cert_dir="$RENDER_DIR/ssl"
    mkdir -p "$cert_dir"
    local crt="$cert_dir/$domain.crt"
    local key="$cert_dir/$domain.key"

    echo
    INFO "Nginx 需要 SSL 证书。选择证书来源:"
    echo -e "  1) 自动生成自签证书 (仅供测试, 浏览器会告警)"
    echo -e "  2) 我已自有证书, 稍后手动填写路径"
    local cert_src
    read -e -p "$(INFO "请选择 [1/2] > ")" cert_src

    if [ "$cert_src" = "1" ]; then
        INFO "生成自签证书到 $cert_dir ..."
        openssl req -x509 -nodes -days 365 -newkey rsa:2048 \
            -keyout "$key" -out "$crt" \
            -subj "/CN=$domain" >/dev/null 2>&1 \
            && INFO "自签证书已生成" || ERROR "自签证书生成失败(请确认 openssl 已安装)"
    else
        read -e -p "$(INFO "请输入证书 crt 绝对路径 > ")" crt
        read -e -p "$(INFO "请输入证书 key 绝对路径 > ")" key
        if [ ! -f "$crt" ] || [ ! -f "$key" ]; then
            ERROR "证书文件不存在, 请先将证书放到对应路径后重跑本脚本"
            exit 1
        fi
    fi

    mkdir -p /etc/nginx/conf.d
    sed -e "s/your_domain_name/$domain/g" \
        -e "s#your_domain_name.crt#$crt#g" \
        -e "s#your_domain_name.key#$key#g" \
        "$(ensure_template config/nginx/registry-proxy-go.conf)" > /etc/nginx/conf.d/docker-proxy-go.conf

    # 移除默认站点, 避免冲突
    rm -f /etc/nginx/conf.d/default.conf

    if ! command -v nginx >/dev/null 2>&1; then
        INFO "安装 Nginx ..."
        PKG_INSTALL nginx >/dev/null 2>&1 || { ERROR "Nginx 安装失败"; exit 1; }
    fi

    nginx -t >/dev/null 2>&1 && INFO "Nginx 配置语法正确" || { ERROR "Nginx 配置校验失败, 请检查 /etc/nginx/conf.d/docker-proxy-go.conf"; exit 1; }
    systemctl enable --now nginx >/dev/null 2>&1 || service nginx restart >/dev/null 2>&1
    INFO "Nginx 反代已启动 (域名: $domain)"
}

RENDER_CADDY() {
    local domain="$1"
    mkdir -p "$RENDER_DIR"
    sed -e "s/your_domain_name/$domain/g" "$(ensure_template config/caddy/Caddyfile)" > "$RENDER_DIR/Caddyfile"

    # 用 docker 运行 caddy, 自动申请 Let's Encrypt 证书(需域名已解析且 80/443 可访问)
    docker rm -f docker-proxy-caddy >/dev/null 2>&1
    docker run -d --name docker-proxy-caddy --restart always \
        -p 80:80 -p 443:443 \
        -v "$RENDER_DIR/Caddyfile:/etc/caddy/Caddyfile" \
        caddy:latest >/dev/null 2>&1 \
        && INFO "Caddy 反代容器已启动 (域名: $domain, 自动申请证书)" \
        || ERROR "Caddy 容器启动失败"
}

CONFIG_PROXY() {
    echo
    SEPARATOR "反向代理(对外提供子域访问)"
    echo -e "${BOLD}是否配置反向代理?${RESET}"
    echo -e "  1) Nginx  (系统安装, 需提供 SSL 证书)"
    echo -e "  2) Caddy  (Docker 运行, 自动申请免费证书, 推荐)"
    echo -e "  3) 暂不配置 (直接用 http://IP:50000 和 http://IP:30080 访问)"
    read -e -p "$(INFO "请选择 [1/2/3] > ")" pc
    case "$pc" in
        1)
            PROXY_CHOICE="nginx"
            ASK_DOMAIN
            RENDER_NGINX "$PROXY_DOMAIN"
            OPEN_PORTS "80 443"
            ;;
        2)
            PROXY_CHOICE="caddy"
            ASK_DOMAIN
            RENDER_CADDY "$PROXY_DOMAIN"
            OPEN_PORTS "80 443"
            ;;
        3)
            PROXY_CHOICE="none"
            INFO "跳过反代, 部署后可用 http://<服务器IP>:50000 (代理) 和 :30080 (管理面板)"
            ;;
        *)
            WARN "无效选择, 默认不配置反代"
            PROXY_CHOICE="none"
            ;;
    esac
}

# ===================================================================
# 部署
# ===================================================================
GEN_ENV() {
    if [ -f "$ENV_FILE" ]; then
        INFO ".env 已存在, 复用现有 GO_PROXY_ADMIN_TOKEN"
    else
        local token
        if command -v openssl >/dev/null 2>&1; then
            token="$(openssl rand -hex 24)"
        else
            token="$(head -c 24 /dev/urandom | xxd -p | tr -d '\n')"
        fi
        cat > "$ENV_FILE" <<EOF
# Go 代理管理 API 令牌 (请妥善保管, 切勿泄露)
GO_PROXY_ADMIN_TOKEN=$token

# 镜像地址 (可选覆盖, 等号右侧为默认值)
# 若构建时未选择 latest 标签, 请在此显式指定对应标签, 否则默认拉取 :latest 会失败
REGISTRY_IMAGE=dqzboy/registry:latest
UI_IMAGE=dqzboy/hubcmd-ui:latest
EOF
        chmod 600 "$ENV_FILE"
        INFO "已生成 .env 并写入随机管理令牌"
    fi
}

ENSURE_CONFIG() {
    if [ ! -f "$GO_PROXY_CONFIG" ]; then
        mkdir -p "$(dirname "$GO_PROXY_CONFIG")"
        if [ -f "$GO_PROXY_CONFIG_EXAMPLE" ]; then
            cp "$GO_PROXY_CONFIG_EXAMPLE" "$GO_PROXY_CONFIG"
            INFO "已根据仓库默认配置创建 config/go-proxy/config.yaml"
        else
            ERROR "未找到默认配置 (go-proxy/config.yaml), 无法继续"
            exit 1
        fi
    fi
}

DEPLOY() {
    CHECK_COMPOSE || { ERROR "Docker Compose 不可用"; exit 1; }
    # 构建模式需确保宿主机 config/go-proxy/config.yaml 存在；镜像模式由容器入口自动播种
    if [ "$BUILD_FLAG" = "--build" ]; then
        ENSURE_CONFIG
    fi
    GEN_ENV

    if [ "$BUILD_FLAG" = "--build" ]; then
        INFO "开始构建并启动服务 (go-proxy + hubcmd-ui) ..."
    else
        INFO "开始拉取镜像并启动服务 (dqzboy/registry + dqzboy/hubcmd-ui) ..."
    fi
    $DOCKER_COMPOSE_CMD -f "$COMPOSE_PATH" up -d $BUILD_FLAG
    if [ $? -ne 0 ]; then
        ERROR "服务启动失败, 请查看日志: $DOCKER_COMPOSE_CMD -f $COMPOSE_PATH logs"
        exit 1
    fi

    OPEN_PORTS "50000 30080"
    PRINT_SUMMARY
}

PRINT_SUMMARY() {
    echo
    SEPARATOR "部署完成"
    local pub_ip="$(curl -s --max-time 5 https://ifconfig.me 2>/dev/null || echo '你的服务器IP')"
    INFO "Go 代理已启动:"
    if [ "$PROXY_CHOICE" = "nginx" ] || [ "$PROXY_CHOICE" = "caddy" ]; then
        INFO "  子域访问: ${UNDERLINE}https://hub.$PROXY_DOMAIN${RESET} (Docker Hub)"
        INFO "           ${UNDERLINE}https://ghcr.$PROXY_DOMAIN${RESET} (GHCR) 等"
        INFO "           拉取示例: docker pull hub.$PROXY_DOMAIN/library/hello-world"
    else
        INFO "  代理直连: ${UNDERLINE}http://$pub_ip:50000${RESET} (直接 curl -H 'Host: ghcr.io' http://$pub_ip:50000/v2/...)"
        INFO "  管理面板: ${UNDERLINE}http://$pub_ip:30080/admin${RESET}"
    fi
    INFO "  管理面板: ${UNDERLINE}http://$pub_ip:30080/admin${RESET}"
    INFO "  代理管理: 在面板左侧『代理管理』中增删改注册表并点『重载』"
    echo
    WARN "首次使用请在管理面板完成管理员注册/登录。"
    INFO "配置文件: $COMPOSE_PATH  (管理令牌在 $ENV_FILE)"
    SEPARATOR
}

# ===================================================================
# 管理菜单
# ===================================================================
SVC_START()   { $DOCKER_COMPOSE_CMD -f "$COMPOSE_PATH" up -d; INFO "已启动"; }
SVC_STOP()    { $DOCKER_COMPOSE_CMD -f "$COMPOSE_PATH" down; INFO "已停止"; }
SVC_RESTART() { $DOCKER_COMPOSE_CMD -f "$COMPOSE_PATH" restart; INFO "已重启"; }
SVC_LOGS()    { $DOCKER_COMPOSE_CMD -f "$COMPOSE_PATH" logs -f --tail=100; }
SVC_UPDATE()  {
    if [ "$BUILD_FLAG" = "--build" ]; then
        INFO "重新构建并启动 ..."
    else
        INFO "拉取最新镜像并重启 ..."
    fi
    $DOCKER_COMPOSE_CMD -f "$COMPOSE_PATH" up -d $BUILD_FLAG
    INFO "更新完成"
}
SVC_UNINSTALL() {
    while true; do
        read -e -p "$(WARN "确认卸载? 这将停止并删除容器与镜像(数据卷保留) [y/n] ")" ok
        case "$ok" in
            y|Y)
                $DOCKER_COMPOSE_CMD -f "$COMPOSE_PATH" down --rmi local --remove-orphans
                docker rm -f docker-proxy-caddy >/dev/null 2>&1
                rm -f /etc/nginx/conf.d/docker-proxy-go.conf
                INFO "已卸载 Go 代理服务"
                break ;;
            n|N) INFO "已取消"; break ;;
            *) INFO "请输入 y 或 n" ;;
        esac
    done
}
CHANGE_DOMAIN() {
    if [ "$PROXY_CHOICE" = "none" ]; then
        WARN "当前未配置反代, 请先选择 Nginx/Caddy"; return
    fi
    ASK_DOMAIN
    if [ "$PROXY_CHOICE" = "nginx" ]; then RENDER_NGINX "$PROXY_DOMAIN"; fi
    if [ "$PROXY_CHOICE" = "caddy" ]; then RENDER_CADDY "$PROXY_DOMAIN"; fi
}

MANAGE_MENU() {
    while true; do
        echo
        SEPARATOR "服务管理"
        echo -e "1) 启动服务    2) 停止服务    3) 重启服务"
        echo -e "4) 查看日志    5) 更新($([ "$BUILD_FLAG" = "--build" ] && echo 重新构建 || echo 拉取镜像)) 6) 修改反代域名"
        echo -e "7) 卸载        0) 返回主菜单"
        read -e -p "$(INFO "请输入对应数字 > ")" m
        case "$m" in
            1) SVC_START ;;
            2) SVC_STOP ;;
            3) SVC_RESTART ;;
            4) SVC_LOGS ;;
            5) SVC_UPDATE ;;
            6) CHANGE_DOMAIN ;;
            7) SVC_UNINSTALL ;;
            0) return ;;
            *) WARN "无效选择" ;;
        esac
    done
}

# ===================================================================
# 主流程
# ===================================================================
MAIN_MENU() {
    while true; do
        echo
        SEPARATOR "Docker Proxy (Go 纯代理) 一键部署"
        echo -e "${BOLD}1)${RESET} 一键部署 (安装依赖 + 启动 go-proxy + hubcmdui)"
        echo -e "${BOLD}2)${RESET} 服务管理 (启动/停止/重启/日志/更新/卸载)"
        echo -e "${BOLD}0)${RESET} 退出脚本"
        read -e -p "$(INFO "请输入对应数字 > ")" opt
        case "$opt" in
            1) ONE_CLICK_DEPLOY ;;
            2) MANAGE_MENU ;;
            0) INFO "退出"; exit 0 ;;
            *) WARN "无效选择" ;;
        esac
    done
}

ONE_CLICK_DEPLOY() {
    CHECK_ROOT
    CHECK_OS
    CHECK_PKG_MANAGER
    INSTALL_DOCKER
    CONFIG_PROXY
    DEPLOY
}

# 若以参数运行可直连: deploy / manage
case "${1:-}" in
    deploy) ONE_CLICK_DEPLOY ;;
    manage) MANAGE_MENU ;;
    *) MAIN_MENU ;;
esac
