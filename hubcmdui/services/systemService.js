/**
 * 系统服务模块 - 处理系统级信息获取
 *
 * 使用 systeminformation 库提供跨平台、准确的系统数据。
 * 本模块是「实时资源接口(/api/system-resources)」与「历史指标采集器(metricsService)」
 * 的唯一数据源，保证两者口径完全一致。
 *
 * 为什么不用 os 模块：
 *  - CPU：os.loadavg() 是「运行队列长度」，并非 CPU 占用率；真实占用必须用 si.currentLoad()
 *  - 内存：os.freemem() 把 Linux 可回收的 buff/cache 也算作「已用」，会严重夸大占用；
 *          si.mem() 的 used/available 才是真实口径
 *  - 磁盘 / 网络 / 温度：os 模块根本没有对应能力
 */
const si = require('systeminformation');
const os = require('os');
const logger = require('../logger');

// 预热：systeminformation 的 currentLoad 首次调用返回「自启动以来」的平均值，
// 这里先空打一次，使后续真实调用得到「采样间隔内」的 CPU 占用率。
si.currentLoad().catch(() => {});

// 网络流量计算：systeminformation 的 networkStats() 默认只返回一个"默认"接口，
// 在云服务器上经常不是真实流量接口；改为 networkStats('*') 获取全部接口后聚合。
// systeminformation 第二次调用会给出 rx_sec/tx_sec（基于其内部采样），优先使用；
// 若不存在（首次或特殊环境），再用累计字节自行兜底计算。
let lastNetSnapshot = null;

function shouldIncludeInterface(n) {
  const iface = String(n.iface || '').toLowerCase();
  // 排除回环
  if (iface === 'lo' || iface.startsWith('lo')) return false;
  // 排除明显 down 掉且无流量的接口
  if (n.operstate === 'down') return false;
  // 排除常见本地虚拟/桥接接口（这些不会承载外部流量）
  const virtualPatterns = [
    /^docker/, /^veth/, /^br-/, /^virbr/, /^vmnet/, /^bridge/,
    /^awdl/, /^llw/, /^anpi/, /^ap/, /^nan/
  ];
  if (virtualPatterns.some(p => p.test(iface))) return false;
  return true;
}

function aggregateNetworkStats(netStats) {
  return (netStats || []).filter(shouldIncludeInterface);
}

function computeNetworkSpeed(netStats) {
  const now = Date.now();
  const interfaces = aggregateNetworkStats(netStats);

  // 优先使用 systeminformation 自己计算的速率（需要两次调用间隔作为采样窗口）
  let rxSec = interfaces.reduce((sum, n) => sum + (n.rx_sec || 0), 0);
  let txSec = interfaces.reduce((sum, n) => sum + (n.tx_sec || 0), 0);

  // 兜底：若 systeminformation 未返回速率（首次调用或某些环境），用累计字节自己算
  const totalRx = interfaces.reduce((sum, n) => sum + (n.rx_bytes || 0), 0);
  const totalTx = interfaces.reduce((sum, n) => sum + (n.tx_bytes || 0), 0);
  if ((!rxSec && !txSec) && lastNetSnapshot && (now - lastNetSnapshot.ts) > 0) {
    const dt = (now - lastNetSnapshot.ts) / 1000;
    rxSec = Math.max(0, (totalRx - lastNetSnapshot.rx) / dt);
    txSec = Math.max(0, (totalTx - lastNetSnapshot.tx) / dt);
  }

  lastNetSnapshot = { ts: now, rx: totalRx, tx: totalTx };

  const activeIfaces = interfaces.filter(n => (n.rx_bytes || 0) > 0 || (n.tx_bytes || 0) > 0);
  logger.debug(`网络聚合: ${interfaces.length} 个接口, 活跃 ${activeIfaces.length} 个, rx=${rxSec.toFixed(2)} B/s, tx=${txSec.toFixed(2)} B/s`);
  return {
    rxSec: +rxSec.toFixed(2),
    txSec: +txSec.toFixed(2),
    interfaces: interfaces.map(n => n.iface),
    activeInterfaces: activeIfaces.map(n => n.iface)
  };
}

// 字节转可读单位
function formatBytes(bytes, decimals = 2) {
  if (bytes == null || isNaN(bytes) || bytes === 0) return '0 Bytes';
  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB', 'PB', 'EB', 'ZB', 'YB'];
  try {
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
  } catch (e) {
    return 'N/A';
  }
}

/**
 * 获取核心系统资源信息（CPU / 内存 / 磁盘 / 网络 / 温度）。
 * 全部基于 systeminformation，数值准确。
 */
async function getSystemResources() {
  try {
    logger.info('Fetching system resources using systeminformation...');
    const [cpuLoad, mem, fsSize, cpuInfo, osInfo, netStats, cpuTemp] = await Promise.all([
      si.currentLoad(),
      si.mem(),
      si.fsSize(),
      si.cpu(),
      si.osInfo(),
      si.networkStats('*').catch(() => []),
      si.cpuTemperature().catch(() => ({ main: null }))
    ]);

    // --- CPU ---
    const cpuUsage = typeof cpuLoad.currentLoad === 'number' ? +cpuLoad.currentLoad.toFixed(1) : null;
    const perCore = Array.isArray(cpuLoad.cpus) ? cpuLoad.cpus.map(c => +(+c.load).toFixed(1)) : [];
    const loadAvg = osInfo.platform !== 'win32' ? os.loadavg().map(l => +l.toFixed(2)) : null;
    const temp = (cpuTemp && typeof cpuTemp.main === 'number') ? +cpuTemp.main.toFixed(0) : null;

    const cpuData = {
      cores: cpuInfo.cores || os.cpus().length || 1,
      physicalCores: cpuInfo.physicalCores,
      model: (cpuInfo.manufacturer + ' ' + cpuInfo.brand).trim() || '未知',
      speed: cpuInfo.speed,
      usage: cpuUsage,            // 真实 CPU 占用率（%）
      perCore,                    // 每核负载（%）
      temp,                       // CPU 温度（°C），可能为 null
      loadAvg,                    // [1m,5m,15m] 仅作参考，不等于占用率
      load1: loadAvg ? loadAvg[0] : null
    };

    // --- 内存 ---
    const memUsedPct = mem.total > 0 ? +((mem.used / mem.total) * 100).toFixed(1) : null;
    const memAvailPct = (mem.total > 0 && typeof mem.available === 'number')
      ? +((mem.available / mem.total) * 100).toFixed(1) : null;
    const memData = {
      total: mem.total,
      free: mem.free,
      used: mem.used,
      active: mem.active,
      available: mem.available,
      wired: mem.wired,
      buffcache: mem.buffcache,
      usedPercentage: memUsedPct,       // 已用百分比（基于 used/total）
      availablePercentage: memAvailPct  // 真正可用百分比（含可回收缓存）
    };

    // --- 磁盘（选取挂载在 / 的主盘；Windows 取 C:）---
    let mainDisk = null;
    if (osInfo.platform === 'win32') {
      mainDisk = (fsSize || []).find(d => d.fs && d.fs.startsWith('C:'));
    } else {
      mainDisk = (fsSize || []).find(d => d.mount === '/');
    }
    if (!mainDisk && Array.isArray(fsSize) && fsSize.length) mainDisk = fsSize[0];

    const diskData = mainDisk ? {
      mount: mainDisk.mount,
      size: formatBytes(mainDisk.size),
      used: formatBytes(mainDisk.used),
      available: formatBytes(mainDisk.available),
      percent: (typeof mainDisk.use === 'number') ? mainDisk.use.toFixed(0) + '%' : 'N/A',
      usedPercentage: (typeof mainDisk.use === 'number') ? +mainDisk.use.toFixed(1) : null,
      usedBytes: mainDisk.used,
      sizeBytes: mainDisk.size
    } : {
      mount: 'N/A', size: 'N/A', used: 'N/A', available: 'N/A',
      percent: 'N/A', usedPercentage: null
    };

    // --- 网络吞吐（聚合所有非回环网卡 rx/tx，单位 bytes/sec）---
    const { rxSec, txSec, interfaces: netInterfaces } = computeNetworkSpeed(netStats);
    const networkData = {
      rxSec: +rxSec.toFixed(2),
      txSec: +txSec.toFixed(2),
      interfaces: netInterfaces
    };

    const resources = {
      osType: osInfo.platform,
      osDistro: osInfo.distro,
      cpu: cpuData,
      memory: memData,
      disk: diskData,
      network: networkData,
      system: {
        platform: osInfo.platform,
        release: osInfo.release,
        // Docker 中 osInfo.hostname 默认是容器 ID，优先使用部署时传入的 HOST_NAME 环境变量
        hostname: process.env.HOST_NAME || osInfo.hostname || os.hostname(),
        uptime: Math.floor(os.uptime())   // 秒（数字），由前端 formatUptime 格式化
      }
    };
    logger.info('Successfully fetched system resources (osType=' + resources.osType + ')');
    return resources;
  } catch (error) {
    logger.error('获取系统资源失败 (services/systemService.js):', error);
    throw new Error('Failed to get system resources: ' + error.message);
  }
}

/**
 * 返回网卡累计字节数与实时速率（聚合所有非回环网卡）。
 * 用于「网络流量监控」页：累计字节落库以便绘制历史吞吐曲线，
 * 实时速率用于当前上下行速率卡。
 * @returns {Promise<{rxBytes:number, txBytes:number, rxSec:number, txSec:number, interfaces:string[]}>}
 */
async function getNetworkCounters() {
  const netStats = await si.networkStats('*');
  const ifaces = aggregateNetworkStats(netStats);
  const rxBytes = ifaces.reduce((s, n) => s + (Number(n.rx_bytes) || 0), 0);
  const txBytes = ifaces.reduce((s, n) => s + (Number(n.tx_bytes) || 0), 0);
  const speed = computeNetworkSpeed(netStats);
  return {
    rxBytes,
    txBytes,
    rxSec: speed.rxSec,
    txSec: speed.txSec,
    interfaces: speed.interfaces,
    activeInterfaces: speed.activeInterfaces
  };
}

module.exports = { getSystemResources, getNetworkCounters };
