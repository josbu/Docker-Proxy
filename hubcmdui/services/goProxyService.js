/**
 * Go 代理管理服务对象
 * 通过 Go 代理的管理端口（默认 :5001）读写配置 / 热重载。
 * 与 Go 端通过 JSON 通信，Go 端负责 YAML 序列化，避免前端引入 yaml 依赖。
 */

const axios = require('axios');
const logger = require('../logger');

// Go 代理管理接口地址（docker 网络内可达，不对外暴露）
const ADMIN_BASE = process.env.GO_PROXY_ADMIN_URL || 'http://go-proxy:5001';
// 管理接口鉴权令牌（与 Go 端 GO_PROXY_ADMIN_TOKEN 保持一致）
const ADMIN_TOKEN = process.env.GO_PROXY_ADMIN_TOKEN || '';

function adminHeaders() {
  const h = { 'Content-Type': 'application/json' };
  if (ADMIN_TOKEN) {
    h['X-Admin-Token'] = ADMIN_TOKEN;
  }
  return h;
}

class GoProxyService {
  /**
   * 获取当前代理配置（密码已被 Go 端脱敏为 ********）
   */
  async getConfig() {
    const { data } = await axios.get(`${ADMIN_BASE}/-/config`, {
      headers: adminHeaders(),
      timeout: 8000
    });
    return data;
  }

  /**
   * 全量替换代理配置（写盘 + 热重载）
   */
  async putConfig(cfg) {
    const { data } = await axios.put(`${ADMIN_BASE}/-/config`, cfg, {
      headers: adminHeaders(),
      timeout: 8000
    });
    return data;
  }

  /**
   * 从磁盘重新加载配置
   */
  async reload() {
    const { data } = await axios.post(`${ADMIN_BASE}/-/reload`, {}, {
      headers: adminHeaders(),
      timeout: 8000
    });
    return data;
  }

  /**
   * 健康检查（公开端点，不需要 token）
   */
  async status() {
    try {
      const r = await axios.get(`${ADMIN_BASE}/-/healthz`, { timeout: 5000 });
      return { reachable: r.status === 200 };
    } catch (e) {
      return { reachable: false, error: e.message };
    }
  }
}

// 把 axios 错误转换成可返回给前端的错误体
function upstreamError(e) {
  if (e.response && e.response.data) {
    return { status: e.response.status, body: e.response.data };
  }
  return { status: 502, body: { error: e.message } };
}

module.exports = {
  goProxyService: new GoProxyService(),
  upstreamError,
  ADMIN_BASE
};
