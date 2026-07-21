/**
 * 代理管理模块（Go 纯代理）
 * 与 /api/goProxy 交互，提供注册表代理的增删改、启用/禁用、服务器设置与热重载。
 */

const goProxyManager = {
    currentConfig: null,
    editingName: null,   // 正在编辑的注册表名称；null 表示新增

    // ---------- 初始化 ----------
    init: async function () {
        try {
            await this.loadConfig();
            this.bindEvents();
        } catch (error) {
            console.error('初始化代理管理失败:', error);
        }
    },

    loadConfig: async function () {
        try {
            core.showLoading && core.showLoading();
            const resp = await fetch('/api/goProxy/config');
            if (!resp.ok) {
                const err = await resp.json().catch(() => ({}));
                throw new Error(err.error || ('HTTP ' + resp.status));
            }
            this.currentConfig = await resp.json();
            this.renderServerSettings();
            this.renderRegistries();
        } catch (error) {
            console.error('加载代理配置失败:', error);
            core.showAlert('加载代理配置失败: ' + error.message, 'error');
        } finally {
            core.hideLoading && core.hideLoading();
        }
    },

    // ---------- 渲染：服务器设置 ----------
    renderServerSettings: function () {
        const s = (this.currentConfig && this.currentConfig.server) || {};
        const setVal = (id, v) => { const e = document.getElementById(id); if (e) e.value = (v === undefined || v === null) ? '' : v; };
        setVal('gp-listen', s.listen || ':5000');
        setVal('gp-read-timeout', s.read_timeout === undefined ? 60 : s.read_timeout);
        setVal('gp-write-timeout', s.write_timeout === undefined ? 0 : s.write_timeout);
        setVal('gp-idle-timeout', s.idle_timeout === undefined ? 120 : s.idle_timeout);

        const sel = document.getElementById('gp-default');
        if (sel) {
            const regs = (this.currentConfig && this.currentConfig.registries) || [];
            sel.innerHTML = regs.map(r => `<option value="${escapeHtml(r.name)}">${escapeHtml(r.name)}</option>`).join('')
                || '<option value="">（无可用注册表）</option>';
            sel.value = (this.currentConfig && this.currentConfig.default) || '';
        }
    },

    // ---------- 渲染：注册表列表 ----------
    renderRegistries: function () {
        const tbody = document.getElementById('gp-registry-tbody');
        if (!tbody) return;
        const list = (this.currentConfig && this.currentConfig.registries) || [];
        if (list.length === 0) {
            tbody.innerHTML = `<tr><td colspan="6" class="table-empty-state">
                <i class="fas fa-inbox"></i><p>暂无代理，点击右上角“添加代理”创建第一个</p></td></tr>`;
            return;
        }
        tbody.innerHTML = list.map(r => {
            const enabled = r.enabled !== false;
            const badge = enabled
                ? '<span class="badge bg-success">已启用</span>'
                : '<span class="badge bg-secondary">已禁用</span>';
            const hosts = (r.hosts || []).join(', ');
            return `<tr>
                <td><code>${escapeHtml(r.name)}</code></td>
                <td>${escapeHtml(hosts)}</td>
                <td><code>${escapeHtml(r.upstream || '')}</code></td>
                <td>${escapeHtml((r.auth && r.auth.type) || 'token')}</td>
                <td>${badge}</td>
                <td class="action-cell">
                    <button class="btn btn-sm btn-primary" onclick="goProxyManager.editRegistry('${escapeHtml(r.name)}')" title="编辑"><i class="fas fa-edit"></i></button>
                    <button class="btn btn-sm btn-warning" onclick="goProxyManager.toggleEnabled('${escapeHtml(r.name)}')" title="启用/禁用"><i class="fas fa-power-off"></i></button>
                    <button class="btn btn-sm btn-danger" onclick="goProxyManager.deleteRegistry('${escapeHtml(r.name)}')" title="删除"><i class="fas fa-trash"></i></button>
                </td>
            </tr>`;
        }).join('');
    },

    // ---------- 事件绑定 ----------
    bindEvents: function () {
        const addBtn = document.getElementById('gp-add-btn');
        if (addBtn) addBtn.addEventListener('click', () => this.showAddModal());
        const saveBtn = document.getElementById('gp-save-btn');
        if (saveBtn) saveBtn.addEventListener('click', () => this.saveRegistry());
        const srvBtn = document.getElementById('gp-save-server-btn');
        if (srvBtn) srvBtn.addEventListener('click', () => this.saveServerSettings());
        const reloadBtn = document.getElementById('gp-reload-btn');
        if (reloadBtn) reloadBtn.addEventListener('click', () => this.reloadProxy());
        const refreshBtn = document.getElementById('gp-refresh-btn');
        if (refreshBtn) refreshBtn.addEventListener('click', () => this.loadConfig());
    },

    // ---------- 弹窗：新增 / 编辑 ----------
    showAddModal: function () {
        this.editingName = null;
        const f = this.formElements();
        f.name.value = '';
        f.name.disabled = false;
        f.hosts.value = '';
        f.upstream.value = '';
        f.authType.value = 'token';
        f.username.value = '';
        f.password.value = '';
        f.insecure.checked = false;
        f.ttl.value = 3600;
        document.getElementById('gp-modal-title').textContent = '添加代理';
        document.getElementById('gp-pwd-hint').style.display = 'none';
        this.openModal();
    },

    editRegistry: function (name) {
        const r = (this.currentConfig.registries || []).find(x => x.name === name);
        if (!r) return;
        this.editingName = name;
        const f = this.formElements();
        f.name.value = r.name;
        f.name.disabled = true; // 名称不可改，改名请先删除再建
        f.hosts.value = (r.hosts || []).join(', ');
        f.upstream.value = r.upstream || '';
        f.authType.value = (r.auth && r.auth.type) || 'token';
        f.username.value = (r.auth && r.auth.username) || '';
        // 密码已脱敏，显示占位符；留空表示不修改（保存时由后端保留原值）
        f.password.value = '';
        f.insecure.checked = !!r.insecure_skip_verify;
        f.ttl.value = r.token_cache_ttl || 3600;
        document.getElementById('gp-modal-title').textContent = '编辑代理：' + name;
        document.getElementById('gp-pwd-hint').style.display = 'block';
        this.openModal();
    },

    formElements: function () {
        return {
            name: document.getElementById('gp-name'),
            hosts: document.getElementById('gp-hosts'),
            upstream: document.getElementById('gp-upstream'),
            authType: document.getElementById('gp-auth-type'),
            username: document.getElementById('gp-username'),
            password: document.getElementById('gp-password'),
            insecure: document.getElementById('gp-insecure'),
            ttl: document.getElementById('gp-ttl')
        };
    },

    openModal: function () {
        const m = document.getElementById('gpModal');
        if (m && window.bootstrap) {
            bootstrap.Modal.getOrCreateInstance(m).show();
        }
    },

    // ---------- 保存：新增 / 编辑 ----------
    saveRegistry: async function () {
        const f = this.formElements();
        const name = f.name.value.trim();
        const hosts = f.hosts.value.split(',').map(s => s.trim()).filter(Boolean);
        const upstream = f.upstream.value.trim();
        const authType = f.authType.value;
        const username = f.username.value.trim();
        let password = f.password.value;

        if (!name) return core.showAlert('请填写代理名称', 'error');
        if (hosts.length === 0) return core.showAlert('请至少填写一个 Host（域名）', 'error');
        if (!upstream) return core.showAlert('请填写上游地址 upstream', 'error');
        if (!/^https?:\/\//.test(upstream)) return core.showAlert('upstream 必须是 http(s):// 开头的 URL', 'error');

        // 密码处理：编辑且留空 / 占位符 -> 让后端保留原值
        if (this.editingName && (password === '' || password === '********')) {
            password = '********';
        }

        const reg = {
            name,
            hosts,
            upstream,
            auth: { type: authType, username, password },
            insecure_skip_verify: !!f.insecure.checked,
            token_cache_ttl: parseInt(f.ttl.value, 10) || 3600,
            enabled: true
        };

        if (!this.currentConfig.registries) this.currentConfig.registries = [];
        const idx = this.currentConfig.registries.findIndex(x => x.name === name);
        if (idx >= 0) {
            // 保留原有的 enabled 状态
            reg.enabled = this.currentConfig.registries[idx].enabled !== false;
            this.currentConfig.registries[idx] = reg;
        } else {
            this.currentConfig.registries.push(reg);
        }

        const ok = await this.pushConfig('代理已保存');
        if (ok && window.bootstrap) {
            bootstrap.Modal.getOrCreateInstance(document.getElementById('gpModal')).hide();
        }
    },

    deleteRegistry: async function (name) {
        const r = (this.currentConfig.registries || []).find(x => x.name === name);
        if (!r) return;
        const confirm = await this.confirmDialog(`确认删除代理「${name}」？`, '删除后该域名下的镜像拉取将失效。');
        if (!confirm) return;
        this.currentConfig.registries = this.currentConfig.registries.filter(x => x.name !== name);
        // 若删掉的是默认，重置默认
        if (this.currentConfig.default === name) {
            this.currentConfig.default = (this.currentConfig.registries[0] || {}).name || '';
        }
        await this.pushConfig('代理已删除');
    },

    toggleEnabled: async function (name) {
        const r = (this.currentConfig.registries || []).find(x => x.name === name);
        if (!r) return;
        r.enabled = r.enabled === false ? true : false;
        await this.pushConfig(r.enabled ? `已启用 ${name}` : `已禁用 ${name}`);
    },

    saveServerSettings: async function () {
        if (!this.currentConfig.server) this.currentConfig.server = {};
        this.currentConfig.server.listen = document.getElementById('gp-listen').value.trim() || ':5000';
        this.currentConfig.server.read_timeout = parseInt(document.getElementById('gp-read-timeout').value, 10) || 0;
        this.currentConfig.server.write_timeout = parseInt(document.getElementById('gp-write-timeout').value, 10) || 0;
        this.currentConfig.server.idle_timeout = parseInt(document.getElementById('gp-idle-timeout').value, 10) || 0;
        this.currentConfig.default = document.getElementById('gp-default').value || '';
        await this.pushConfig('服务器设置已保存');
    },

    reloadProxy: async function () {
        try {
            core.showLoading && core.showLoading();
            const resp = await fetch('/api/goProxy/reload', { method: 'POST' });
            if (!resp.ok) throw new Error('重载失败');
            core.showAlert('代理配置已重新加载', 'success');
        } catch (e) {
            core.showAlert('重载失败: ' + e.message, 'error');
        } finally {
            core.hideLoading && core.hideLoading();
        }
    },

    // 提交整份配置到后端
    pushConfig: async function (successMsg) {
        try {
            core.showLoading && core.showLoading();
            const resp = await fetch('/api/goProxy/config', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(this.currentConfig)
            });
            if (!resp.ok) {
                const err = await resp.json().catch(() => ({}));
                throw new Error(err.error || ('HTTP ' + resp.status));
            }
            core.showAlert(successMsg || '已保存', 'success');
            await this.loadConfig();
            return true;
        } catch (e) {
            core.showAlert('保存失败: ' + e.message, 'error');
            return false;
        } finally {
            core.hideLoading && core.hideLoading();
        }
    },

    confirmDialog: function (text, sub) {
        return new Promise((resolve) => {
            if (window.Swal) {
                Swal.fire({
                    title: text, html: sub ? `<p>${sub}</p>` : '',
                    icon: 'question', showCancelButton: true,
                    confirmButtonText: '确认', cancelButtonText: '取消'
                }).then(r => resolve(!!r.isConfirmed));
            } else {
                resolve(window.confirm(text));
            }
        });
    }
};

function escapeHtml(str) {
    if (str === undefined || str === null) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

window.goProxyManager = goProxyManager;
