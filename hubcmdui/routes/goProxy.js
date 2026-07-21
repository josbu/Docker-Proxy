/**
 * Go 代理管理路由
 * 提供前端"代理管理"页面所需的后端接口，所有写操作需登录。
 * 实际配置读写由 Go 代理的管理端口完成（见 services/goProxyService.js）。
 */

const express = require('express');
const router = express.Router();
const logger = require('../logger');
const { requireLogin } = require('../middleware/auth');
const { goProxyService, upstreamError } = require('../services/goProxyService');

// 获取当前代理配置
router.get('/config', async (req, res) => {
  try {
    const cfg = await goProxyService.getConfig();
    res.json(cfg);
  } catch (e) {
    logger.error('获取 Go 代理配置失败:', e.message);
    const err = upstreamError(e);
    res.status(err.status || 502).json(err.body);
  }
});

// 全量保存代理配置（写盘 + 热重载）
router.put('/config', requireLogin, async (req, res) => {
  try {
    const cfg = req.body;
    if (!cfg || !Array.isArray(cfg.registries) || cfg.registries.length === 0) {
      return res.status(400).json({ error: '配置格式错误：必须包含非空的 registries 数组' });
    }
    const result = await goProxyService.putConfig(cfg);
    res.json(result);
  } catch (e) {
    logger.error('保存 Go 代理配置失败:', e.message);
    const err = upstreamError(e);
    res.status(err.status || 502).json(err.body);
  }
});

// 从磁盘重新加载配置
router.post('/reload', requireLogin, async (req, res) => {
  try {
    const result = await goProxyService.reload();
    res.json(result);
  } catch (e) {
    logger.error('重载 Go 代理配置失败:', e.message);
    const err = upstreamError(e);
    res.status(err.status || 502).json(err.body);
  }
});

// 代理连通性状态
router.get('/status', async (req, res) => {
  try {
    const s = await goProxyService.status();
    res.json(s);
  } catch (e) {
    res.status(502).json({ reachable: false, error: e.message });
  }
});

module.exports = router;
