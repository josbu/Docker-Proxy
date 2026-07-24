<template>
  <div class="dashboard">
    <div class="dash-head">
      <div>
        <h2 class="dash-title">{{ t('dashboard.title') }}</h2>
        <p class="dash-sub">{{ t('dashboard.subtitle') }}</p>
      </div>
      <div class="dash-actions">
        <span class="live-dot"><i></i>{{ liveText }}</span>
        <el-button size="small" :icon="Refresh" :loading="loading" @click="refresh">{{ t('common.refresh') }}</el-button>
      </div>
    </div>

    <div class="dash-grid">
      <!-- KPI：CPU / 内存 / 磁盘 -->
      <div class="dash-card cell-kpi">
        <RingStat :value="cpuVal" :label="'CPU ' + t('dashboard.load')" :sub="cpuSub" :accent="colors.cpu" :accent2="colors.cpu2" :icon="Cpu" />
        <div class="kpi-footer">
          <div class="kpi-foot-hd">
            <span class="kpi-foot-lab">{{ t('dashboard.miniTrend') }}</span>
            <span class="kpi-foot-stat" :style="{ color: colors.cpu }">{{ t('dashboard.load1m') }} {{ cpuLoad1m }}</span>
          </div>
          <Sparkline :data="history.slice(-60).map(p => p.cpu)" :color="colors.cpu" :height="34" />
        </div>
      </div>
      <div class="dash-card cell-kpi">
        <RingStat :value="memVal" :center-value="memCenter" unit="GB" :label="t('dashboard.memUsage')" :sub="memSub" :accent="colors.mem" :accent2="colors.mem2" :icon="Monitor" />
        <div class="kpi-footer">
          <div class="kpi-foot-hd">
            <span class="kpi-foot-lab">{{ t('dashboard.miniTrend') }}</span>
            <span class="kpi-foot-stat" :style="{ color: colors.mem }">{{ t('dashboard.available') }} {{ fmtGB(memAvailGb) }} GB</span>
          </div>
          <Sparkline :data="history.slice(-60).map(p => p.mem)" :color="colors.mem" :height="34" />
        </div>
      </div>
      <div class="dash-card cell-kpi">
        <RingStat :value="diskVal" :center-value="diskCenter" unit="GB" :label="t('dashboard.diskUsage')" :sub="diskSub" :accent="colors.disk" :accent2="colors.disk2" :icon="Files" />
        <div class="kpi-footer">
          <div class="kpi-foot-hd">
            <span class="kpi-foot-lab">{{ t('dashboard.miniTrend') }}</span>
            <span class="kpi-foot-stat" :style="{ color: colors.disk }">{{ t('dashboard.available') }} {{ fmtGB(diskAvailGb) }} GB</span>
          </div>
          <Sparkline :data="history.slice(-60).map(p => p.disk)" :color="colors.disk" :height="34" />
        </div>
      </div>

      <!-- Docker 状态 -->
      <div class="dash-card cell-docker" :class="dockerRunning ? 'is-ok' : 'is-bad'">
        <div class="docker-top">
          <div class="docker-ic"><el-icon><Box /></el-icon></div>
          <div class="docker-id">
            <div class="docker-title">Docker {{ t('dashboard.service') }}</div>
            <div class="docker-state" :style="{ color: dockerRunning ? pal.success : pal.danger }">
              <span class="state-dot"></span>{{ dockerRunning ? t('dashboard.running') : t('dashboard.unavailable') }}
            </div>
          </div>
        </div>
        <div class="docker-grid">
          <div class="dg">
            <div class="dg-num" :style="{ color: pal.success }">{{ runningCount }}</div>
            <div class="dg-lab">{{ t('dashboard.running') }}</div>
          </div>
          <div class="dg">
            <div class="dg-num">{{ containers.length }}</div>
            <div class="dg-lab">{{ t('dashboard.containerTotal') }}</div>
          </div>
        </div>
        <div class="docker-foot">{{ t('dashboard.hostInfo', { host: hostName, uptime: upTime }) }}</div>
      </div>

      <!-- 资源趋势 -->
      <div class="dash-card cell-trend">
        <div class="card-head">
          <span class="card-title"><el-icon><DataLine /></el-icon> {{ t('dashboard.trendTitle') }}</span>
          <span class="card-hint">{{ trendHint }}</span>
        </div>
        <EChart :option="trendOption" height="280px" />
      </div>

      <!-- 容器状态分布 -->
      <div class="dash-card cell-donut">
        <div class="card-head">
          <span class="card-title"><el-icon><PieChart /></el-icon> {{ t('dashboard.containerDist') }}</span>
        </div>
        <EChart :option="donutOption" height="280px" />
      </div>

      <!-- 网络流量 -->
      <div class="dash-card cell-net">
        <div class="card-head">
          <span class="card-title"><el-icon><Connection /></el-icon> {{ t('dashboard.netTraffic') }}</span>
          <span class="card-hint">{{ t('dashboard.netRealtime') }}</span>
        </div>
        <div class="net-body">
          <div class="net-row">
            <span class="net-ic down">↓</span>
            <span class="net-lab">{{ t('dashboard.netDown') }}</span>
            <span class="net-val">{{ netRxDisplay.value }} <i class="net-unit">{{ netRxDisplay.unit }}</i></span>
          </div>
          <div class="net-row">
            <span class="net-ic up">↑</span>
            <span class="net-lab">{{ t('dashboard.netUp') }}</span>
            <span class="net-val">{{ netTxDisplay.value }} <i class="net-unit">{{ netTxDisplay.unit }}</i></span>
          </div>
        </div>
        <div class="net-footer">
          <div class="net-foot-hd">
            <span class="net-foot-lab">{{ t('dashboard.miniTrend') }}</span>
            <span class="net-foot-stat down">{{ t('dashboard.netPeakDown') }} {{ netRxPeakDisplay.value }} {{ netRxPeakDisplay.unit }}</span>
          </div>
          <Sparkline :data="history.slice(-60).map(p => p.netRx)" color="#10b981" :height="28" />
          <div class="net-foot-hd" style="margin-top: 8px;">
            <span class="net-foot-lab"></span>
            <span class="net-foot-stat up">{{ t('dashboard.netPeakUp') }} {{ netTxPeakDisplay.value }} {{ netTxPeakDisplay.unit }}</span>
          </div>
          <Sparkline :data="history.slice(-60).map(p => p.netTx)" color="#f97316" :height="28" />
        </div>
      </div>

      <!-- 容器列表 -->
      <div class="dash-card cell-list">
        <div class="card-head">
          <span class="card-title"><el-icon><List /></el-icon> {{ t('dashboard.containerOverview', { count: containers.length }) }}</span>
          <el-button size="small" :icon="Refresh" :loading="loading" @click="refresh">{{ t('common.refresh') }}</el-button>
        </div>
        <el-table v-if="dockerRunning && containers.length" :data="containers" size="small" style="width: 100%">
          <el-table-column :label="t('common.name')" prop="name" min-width="150" show-overflow-tooltip />
          <el-table-column :label="t('dashboard.colImage')" prop="image" min-width="240" show-overflow-tooltip />
          <el-table-column :label="t('common.status')" min-width="100">
            <template #default="{ row }">
              <el-tag :type="statusType(row.state)" size="small" effect="dark">{{ row.state }}</el-tag>
            </template>
          </el-table-column>
          <el-table-column label="CPU" prop="cpu" min-width="90" />
          <el-table-column :label="t('dashboard.colMemory')" prop="memory" min-width="100" />
          <el-table-column :label="t('dashboard.colCreated')" prop="created" min-width="170" show-overflow-tooltip />
        </el-table>
        <el-empty v-else :description="dockerRunning ? t('dashboard.noContainer') : t('dashboard.dockerNotRunning')" />
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, onBeforeUnmount, onActivated, onDeactivated } from 'vue'
import { useI18n } from 'vue-i18n'
import { ElMessage } from 'element-plus'
import { Box, Monitor, Cpu, Files, Refresh, DataLine, PieChart, List, Connection } from '@element-plus/icons-vue'
import RingStat from '../components/RingStat.vue'
import EChart from '../components/EChart.vue'
import Sparkline from '../components/Sparkline.vue'
import { useThemeColors } from '../composables/useThemeColors'
import { getSystemResources, getDockerStatus, getMetricsHistory } from '../services'

// 必须显式声明 name，keep-alive 的 include 才能匹配到本组件
defineOptions({ name: 'Dashboard' })

const { palette: pal } = useThemeColors()
const { t } = useI18n()

// ---------- 数据 ----------
const cpuVal = ref(0)
const memVal = ref(0)
const diskVal = ref(0)
const cpuSub = ref('—')
const memSub = ref('—')
const diskSub = ref('—')
const cpuLoad1m = ref('—')
const memAvailGb = ref(null)
const diskAvailGb = ref(null)
const netRx = ref(0) // bytes/sec
const netTx = ref(0) // bytes/sec
const hostName = ref('—')
const upTime = ref('—')

const dockerRunning = ref(false)
const containers = ref([])
const runningCount = computed(() => containers.value.filter(c => c.state === 'running').length)
const loading = ref(false)

// 内存 / 磁盘环形中心显示值（已用 GB）
const memCenter = ref(0)
const diskCenter = ref(0)

// 趋势历史：内存中保留全部（最长 24h），并节流持久化到 localStorage（分钟级降采样）。
// 这样刷新页面 / 重开浏览器后，仍能恢复近 24 小时的曲线，而不是每次都从零开始累积。
const TREND_KEY = 'hubcmdui.trend.v2'
const TREND_WINDOW = 24 * 3600 * 1000 // 保留 24 小时
const PERSIST_INTERVAL = 60 * 1000    // 至少每 60 秒落盘一次
const SAMPLE_STEP = 60 * 1000         // 落盘时按 60 秒降采样，控制 localStorage 体积
const history = ref([])               // 每项为 { ts, cpu, mem, disk, netRx, netTx }
let lastPersistTs = 0
// 历史数据来源：'server' = 后端统一落库；'local' = 浏览器本地兜底；'none' = 无数据
const historySource = ref('none')

function loadHistory() {
  try {
    const raw = localStorage.getItem(TREND_KEY)
    if (!raw) return []
    const arr = JSON.parse(raw)
    if (!Array.isArray(arr)) return []
    const cut = Date.now() - TREND_WINDOW
    return arr.filter(p => p && typeof p.ts === 'number' && p.ts >= cut)
  } catch (_) {
    return []
  }
}

// 按时间窗口降采样：相同 step 窗口只保留最后一个点，避免 localStorage 无限膨胀
function downsample(list, stepMs) {
  const buckets = new Map()
  for (const p of list) {
    if (!p || typeof p.ts !== 'number') continue
    buckets.set(Math.floor(p.ts / stepMs), p)
  }
  return [...buckets.values()].sort((a, b) => a.ts - b.ts)
}

function saveHistory() {
  try {
    const sampled = downsample(history.value, SAMPLE_STEP)
    localStorage.setItem(TREND_KEY, JSON.stringify(sampled))
  } catch (_) { /* 隐私模式 / 容量超限时忽略 */ }
}

function numOrNull(v) {
  const n = parseFloat(v)
  return isFinite(n) ? n : null
}

// 解析百分比：兼容数字（92）或字符串（"92.0%" / "92%"）
function parsePercent(v) {
  if (v == null) return null
  if (typeof v === 'number') return v
  const m = String(v).match(/([\d.]+)/)
  return m ? parseFloat(m[1]) : null
}

// 统一把「字节数字」或「带单位字符串（如 12Gi / 33.11 GB / 926Gi）」转换为 GB 数值
function toGB(v) {
  if (v == null) return null
  if (typeof v === 'number') return v / (1024 ** 3) // 默认按字节处理
  const m = String(v).trim().match(/([\d.]+)\s*([A-Za-z]*)/)
  if (!m) return null
  const num = parseFloat(m[1])
  const unit = (m[2] || 'B').toUpperCase()
  // 以 1024 为进制，Gi/Gib 视为 G（近似）
  const exp = { B: 0, KB: 1, KIB: 1, MB: 2, MIB: 2, GB: 3, GIB: 3, GI: 3, TB: 4, TIB: 4, PB: 5 }[unit]
  if (exp == null) return num // 无法识别单位时，原样返回数字
  return num * (1024 ** (exp - 3))
}

// 格式化 GB 显示，空值回退 —
function fmtGB(v) {
  return (v != null && isFinite(v)) ? v.toFixed(1) : '—'
}

// 把 bytes/sec 自适应格式化为 { value, unit }
function formatSpeed(bps) {
  const n = Number(bps) || 0
  if (n >= 1024 * 1024) return { value: (n / 1024 / 1024).toFixed(2), unit: 'MB/s' }
  if (n >= 1024) return { value: (n / 1024).toFixed(2), unit: 'KB/s' }
  return { value: n.toFixed(2), unit: 'B/s' }
}
const netRxDisplay = computed(() => formatSpeed(netRx.value))
const netTxDisplay = computed(() => formatSpeed(netTx.value))

// 近 60 个采样点（约 5 分钟）的峰值，用于网络流量卡片底部填充
const netRxPeak = computed(() => Math.max(0, ...history.value.slice(-60).map(p => p.netRx || 0)))
const netTxPeak = computed(() => Math.max(0, ...history.value.slice(-60).map(p => p.netTx || 0)))
const netRxPeakDisplay = computed(() => formatSpeed(netRxPeak.value))
const netTxPeakDisplay = computed(() => formatSpeed(netTxPeak.value))

function pushHistory(cpu, mem, disk, rx, tx) {
  const now = Date.now()
  history.value.push({
    ts: now,
    cpu: numOrNull(cpu),
    mem: numOrNull(mem),
    disk: numOrNull(disk),
    netRx: numOrNull(rx),
    netTx: numOrNull(tx)
  })
  // 丢弃超过 24 小时的旧点
  const cut = now - TREND_WINDOW
  while (history.value.length && history.value[0].ts < cut) history.value.shift()
  // 节流落盘：每分钟最多写一次，写入的是分钟级降采样副本（约 1440 点）
  if (now - lastPersistTs >= PERSIST_INTERVAL) {
    lastPersistTs = now
    saveHistory()
  }
}

function norm(list) {
  return (list || []).map(c => ({
    id: c.id || c.Id,
    name: c.name || (Array.isArray(c.Names) ? c.Names[0] : (c.Name || '-')).replace(/^\//, ''),
    image: c.image || c.Image || '-',
    state: c.state || c.State || c.status || t('dashboard.unknown'),
    cpu: c.cpu || 'N/A',
    memory: c.memory || 'N/A',
    created: c.created || '-'
  }))
}

function statusType(state) {
  if (state === 'running') return 'success'
  if (state === 'paused') return 'warning'
  if (state === 'exited' || state === 'dead') return 'danger'
  if (state === 'error') return 'info'
  return 'info'
}

async function refresh() {
  loading.value = true
  // 系统资源与 Docker 状态并行拉取：Docker 直连守护进程较慢，不应拖慢系统资源的展示
  await Promise.allSettled([
    (async () => {
      const r = await getSystemResources()
      const cpu = r.cpu || {}
      const mem = r.memory || {}
      // 兼容两种后端字段命名：diskSpace / disk
      const disk = r.diskSpace || r.disk || {}
      const sys = r.system || {}

      // CPU：优先 usage（systeminformation 真实占用率），其次 percent，最后用 loadAvg 估算
      const cpuPct = numOrNull(cpu.usage)
        ?? parsePercent(cpu.percent)
        ?? (cpu.loadAvg && cpu.cores ? Math.round(cpu.loadAvg[0] / cpu.cores * 100) : null)
        ?? 0
      cpuVal.value = cpuPct
      cpuSub.value = `${cpu.cores || '?'} ${t('dashboard.core')} · 1m ${cpu.loadAvg ? cpu.loadAvg[0].toFixed(2) : (cpu.load1 ?? '—')}${cpu.temp != null ? ' · ' + cpu.temp + '°C' : ''}`

      // 内存：环形百分比用 percent，中心显示已用 GB
      memVal.value = parsePercent(mem.usedPercentage ?? mem.percent) || 0
      const memUsedGb = toGB(mem.used)
      const memTotalGb = toGB(mem.total)
      memCenter.value = memUsedGb ?? 0
      memSub.value = `${fmtGB(memUsedGb)} / ${fmtGB(memTotalGb)} GB`

      // 磁盘：环形百分比用 percent，中心显示已用 GB
      diskVal.value = parsePercent(disk.usedPercentage ?? disk.percent) || 0
      const diskUsedGb = toGB(disk.used)
      const diskTotalGb = toGB(disk.size ?? disk.total)
      diskCenter.value = diskUsedGb ?? 0
      diskSub.value = `${fmtGB(diskUsedGb)} / ${fmtGB(diskTotalGb)} GB`

      // KPI 卡片底部副指标（填充卡片底部空白）
      cpuLoad1m.value = cpu.loadAvg ? cpu.loadAvg[0].toFixed(2) : (cpu.load1 ?? '—')
      memAvailGb.value = toGB(mem.available)
      diskAvailGb.value = toGB(disk.available) ?? (diskTotalGb - diskUsedGb)

      // 网络吞吐（systeminformation 实测 rx/tx，单位 bytes/sec，前端自适应单位展示）
      const net = r.network || {}
      netRx.value = net.rxSec || 0
      netTx.value = net.txSec || 0

      hostName.value = sys.hostname || r.hostname || '—'
      upTime.value = formatUptime(typeof r.uptime === 'number' ? r.uptime : (sys.uptime || 0))
      pushHistory(cpuVal.value, memVal.value, diskVal.value, netRx.value, netTx.value)
    })().catch(e => {
      ElMessage.error(t('dashboard.fetchSysFailed') + (e.response?.data?.error || e.message))
    }),
    (async () => {
      const d = await getDockerStatus()
      // 后端返回的是数组（每个容器一项，不可用时有 error 标记）
      const arr = Array.isArray(d) ? d : []
      dockerRunning.value = arr.length > 0 && !arr[0].error
      containers.value = norm(arr.filter(c => !c.error))
    })().catch(() => {
      dockerRunning.value = false
      containers.value = []
    })
  ])
  loading.value = false
}

// ---------- 配色 ----------
const colors = {
  cpu: '#3b82f6', cpu2: '#06b6d4',
  mem: '#6366f1', mem2: '#a855f7',
  disk: '#f59e0b', disk2: '#ef4444'
}

// ---------- 趋势图 ----------
const trendHint = computed(() => {
  const h = history.value
  if (!h.length) return t('dashboard.noData')
  const spanMs = h[h.length - 1].ts - h[0].ts
  const spanText = spanMs >= 3600000
    ? (spanMs / 3600000).toFixed(1) + ' ' + t('dashboard.hour')
    : Math.max(1, Math.round(spanMs / 60000)) + ' ' + t('dashboard.minute')
  const src = historySource.value === 'server' ? t('dashboard.srcServer') : t('dashboard.srcLocal')
  return `${src} ${spanText} · ${t('dashboard.realtime5s')}`
})

const trendOption = computed(() => {
  const p = pal.value
  const axis = p['--muted-2'] || '#94a3b8'
  const split = p['--border'] || '#e2e8f0'
  const mk = (name, data, color) => ({
    name, type: 'line', smooth: true, showSymbol: false,
    sampling: 'lttb', large: true, data,
    lineStyle: { width: 2.5, color },
    itemStyle: { color },
    areaStyle: {
      color: {
        type: 'linear', x: 0, y: 0, x2: 0, y2: 1,
        colorStops: [
          { offset: 0, color: color + '59' },
          { offset: 1, color: color + '03' }
        ]
      }
    }
  })
  return {
    grid: { left: 44, right: 16, top: 36, bottom: 28 },
    tooltip: {
      trigger: 'axis',
      backgroundColor: p['--bg-card'] || '#fff',
      borderColor: split,
      textStyle: { color: p['--fg'] || '#0f172a' },
      valueFormatter: v => (v == null ? '—' : v + '%')
    },
    legend: {
      data: ['CPU', t('dashboard.colMemory'), t('dashboard.legendDisk')], top: 4, right: 8,
      textStyle: { color: p['--fg-2'] || '#334155' },
      itemWidth: 14, itemHeight: 8, icon: 'roundRect'
    },
    xAxis: {
      type: 'time',
      axisLine: { lineStyle: { color: split } },
      axisLabel: { color: axis, fontSize: 11 },
      axisTick: { show: false },
      splitLine: { show: false }
    },
    yAxis: {
      type: 'value', min: 0, max: 100,
      axisLabel: { color: axis, fontSize: 11, formatter: '{value}%' },
      splitLine: { lineStyle: { color: split, type: 'dashed' } }
    },
    series: [
      mk('CPU', history.value.map(p => [p.ts, p.cpu]), colors.cpu),
      mk(t('dashboard.colMemory'), history.value.map(p => [p.ts, p.mem]), colors.mem),
      mk(t('dashboard.legendDisk'), history.value.map(p => [p.ts, p.disk]), colors.disk)
    ]
  }
})

// ---------- 容器状态饼图 ----------
const donutOption = computed(() => {
  const p = pal.value
  const buckets = [
    { name: t('dashboard.running'), color: p['--success'] || '#16a34a', n: 0 },
    { name: t('dashboard.paused'), color: p['--warning'] || '#d97706', n: 0 },
    { name: t('dashboard.stopped'), color: p['--danger'] || '#dc2626', n: 0 },
    { name: t('dashboard.other'), color: p['--muted-2'] || '#94a3b8', n: 0 }
  ]
  containers.value.forEach(c => {
    const s = (c.state || '').toLowerCase()
    if (s === 'running') buckets[0].n++
    else if (s === 'paused') buckets[1].n++
    else if (s === 'exited' || s === 'dead') buckets[2].n++
    else buckets[3].n++
  })
  const data = buckets.filter(b => b.n > 0)
  return {
    tooltip: {
      trigger: 'item',
      backgroundColor: p['--bg-card'] || '#fff',
      borderColor: p['--border'] || '#e2e8f0',
      textStyle: { color: p['--fg'] || '#0f172a' },
      formatter: '{b}: {c} ({d}%)'
    },
    legend: {
      bottom: 0, left: 'center',
      textStyle: { color: p['--fg-2'] || '#334155' },
      itemWidth: 12, itemHeight: 12, icon: 'circle'
    },
    series: [{
      type: 'pie', radius: ['52%', '74%'], center: ['50%', '44%'],
      avoidLabelOverlap: true, padAngle: 2,
      itemStyle: { borderRadius: 6, borderColor: p['--bg-card'] || '#fff', borderWidth: 2 },
      label: {
        show: true, position: 'center',
        formatter: () => `{a|${containers.value.length}}\n{b|${t('dashboard.containerTotal')}}`,
        rich: {
          a: { fontSize: 30, fontWeight: 700, color: p['--fg'] || '#0f172a' },
          b: { fontSize: 12, color: p['--muted'] || '#64748b', padding: [4, 0, 0, 0] }
        }
      },
      emphasis: { label: { show: true }, scaleSize: 6 },
      data: data.map(b => ({ name: b.name, value: b.n, itemStyle: { color: b.color } }))
    }]
  }
})

// ---------- 自动刷新 ----------
const liveText = computed(() => t('dashboard.live'))
let timer = null
function startTimer() {
  if (timer) clearInterval(timer)
  timer = setInterval(refresh, 5000)
}
function stopTimer() {
  if (timer) { clearInterval(timer); timer = null }
}
onMounted(async () => {
  // 优先从后端加载近 24 小时统一历史（跨设备/跨会话共享）；
  // 后端接口不可达时回退到浏览器本地 localStorage，保证看板依然可用。
  try {
    const data = await getMetricsHistory(24)
    const pts = data && Array.isArray(data.points) ? data.points : []
    if (pts.length) {
      history.value = pts.map(p => ({
        ts: p.ts,
        cpu: p.cpu,
        mem: p.memory,
        disk: p.disk,
        netRx: p.netRx ?? null,
        netTx: p.netTx ?? null
      }))
      historySource.value = 'server'
    } else {
      history.value = loadHistory()
      historySource.value = history.value.length ? 'local' : 'none'
    }
  } catch (_) {
    history.value = loadHistory()
    historySource.value = history.value.length ? 'local' : 'none'
  }
  lastPersistTs = history.value.length ? history.value[history.value.length - 1].ts : 0
  refresh()
  startTimer()
})
// keep-alive 下切出系统看板：暂停轮询，避免后台空转（组件实例与数据保留，切回时无需重新加载）
onDeactivated(() => stopTimer())
// keep-alive 下切回系统看板：立刻用上次缓存的数据显示（无需等待），再静默刷新一次
onActivated(() => {
  refresh()
  startTimer()
})
onBeforeUnmount(() => stopTimer())

// 把秒数格式化为「x天 x小时 x分钟 x秒」
function formatUptime(seconds) {
  const s = Number(seconds) || 0
  const days = Math.floor(s / 86400)
  const hours = Math.floor((s % 86400) / 3600)
  const minutes = Math.floor((s % 3600) / 60)
  const secs = Math.floor(s % 60)
  const parts = []
  if (days > 0) parts.push(`${days}${t('dashboard.day')}`)
  if (hours > 0 || days > 0) parts.push(`${hours}${t('dashboard.hour')}`)
  if (minutes > 0 || hours > 0 || days > 0) parts.push(`${minutes}${t('dashboard.minute')}`)
  if (parts.length === 0) parts.push(`${secs}${t('dashboard.second')}`)
  return parts.join(' ')
}
</script>

<style scoped>
.dashboard { display: flex; flex-direction: column; gap: 18px; }
.dash-head { display: flex; align-items: flex-end; justify-content: space-between; gap: 16px; flex-wrap: wrap; }
.dash-title { margin: 0; font-size: 22px; font-weight: 700; color: var(--fg); }
.dash-sub { margin: 4px 0 0; font-size: 13px; color: var(--muted); }
.dash-actions { display: flex; align-items: center; gap: 12px; }
.live-dot { display: inline-flex; align-items: center; gap: 6px; font-size: 12px; color: var(--muted); }
.live-dot i {
  width: 8px; height: 8px; border-radius: 50%; background: var(--success);
  box-shadow: 0 0 0 0 var(--success); animation: pulse 1.8s infinite;
}
@keyframes pulse {
  0% { box-shadow: 0 0 0 0 color-mix(in srgb, var(--success) 60%, transparent); }
  70% { box-shadow: 0 0 0 8px transparent; }
  100% { box-shadow: 0 0 0 0 transparent; }
}

.dash-grid { display: grid; grid-template-columns: repeat(12, 1fr); gap: 16px; }
.cell-kpi { grid-column: span 3; }
.cell-docker { grid-column: span 3; }
.cell-trend { grid-column: span 6; }
.cell-donut { grid-column: span 3; }
.cell-net { grid-column: span 3; }
.cell-list { grid-column: span 12; }

.dash-card {
  background: var(--bg-card); border: 1px solid var(--border);
  border-radius: 14px; padding: 18px;
  transition: box-shadow .25s ease, transform .25s ease, border-color .25s ease;
}
.dash-card:hover { box-shadow: var(--shadow-hover); transform: translateY(-2px); border-color: var(--border-strong); }

/* KPI 卡片：内容顶部对齐，底部用趋势图+副指标填满 */
.cell-kpi.dash-card { display: flex; flex-direction: column; }
.kpi-footer { margin-top: auto; padding-top: 14px; }
.kpi-foot-hd { display: flex; align-items: center; justify-content: space-between; margin-bottom: 6px; }
.kpi-foot-lab { font-size: 12px; color: var(--muted); }
.kpi-foot-stat { font-size: 12px; font-weight: 600; }

.card-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px; }
.card-title { display: inline-flex; align-items: center; gap: 7px; font-size: 15px; font-weight: 600; color: var(--fg); }
.card-title .el-icon { color: var(--accent); }
.card-hint { font-size: 12px; color: var(--muted); }

/* Docker 状态卡 */
.docker-top { display: flex; align-items: center; gap: 14px; }
.docker-ic {
  width: 48px; height: 48px; border-radius: 12px; flex: 0 0 auto;
  display: flex; align-items: center; justify-content: center; font-size: 24px;
  background: var(--accent-soft); color: var(--accent);
}
.cell-docker.is-bad .docker-ic { background: color-mix(in srgb, var(--danger) 14%, transparent); color: var(--danger); }
.docker-title { font-size: 14px; font-weight: 600; color: var(--fg-2); }
.docker-state { display: inline-flex; align-items: center; gap: 6px; font-size: 18px; font-weight: 700; margin-top: 2px; }
/* 状态点：用 .is-ok / .is-bad 显式控制颜色，不依赖 currentColor 继承（9x9 + blur 容易吃色） */
.state-dot {
  width: 10px; height: 10px; border-radius: 50%;
  background: var(--muted-2);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--muted-2) 20%, transparent);
  transition: background .2s, box-shadow .2s;
}
.cell-docker.is-ok  .state-dot {
  background: var(--success);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--success) 22%, transparent), 0 0 8px color-mix(in srgb, var(--success) 60%, transparent);
  animation: docker-pulse 1.8s ease-in-out infinite;
}
.cell-docker.is-bad .state-dot {
  background: var(--danger);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--danger) 22%, transparent), 0 0 8px color-mix(in srgb, var(--danger) 60%, transparent);
}
@keyframes docker-pulse {
  0%, 100% { box-shadow: 0 0 0 3px color-mix(in srgb, var(--success) 22%, transparent), 0 0 6px color-mix(in srgb, var(--success) 50%, transparent); }
  50%      { box-shadow: 0 0 0 5px color-mix(in srgb, var(--success) 14%, transparent), 0 0 12px color-mix(in srgb, var(--success) 70%, transparent); }
}
.docker-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin: 16px 0 14px; }
.dg { background: var(--bg-card-2); border: 1px solid var(--border); border-radius: 10px; padding: 12px; text-align: center; }
.dg-num { font-size: 26px; font-weight: 700; color: var(--fg); font-variant-numeric: tabular-nums; }
.dg-lab { font-size: 12px; color: var(--muted); margin-top: 2px; }
.docker-foot { font-size: 12px; color: var(--muted); border-top: 1px dashed var(--border); padding-top: 10px; }

.net-body { display: flex; flex-direction: column; gap: 14px; margin-top: 14px; }
.net-row { display: flex; align-items: center; gap: 10px; }
.net-ic { width: 30px; height: 30px; border-radius: 8px; display: inline-flex; align-items: center; justify-content: center; font-weight: 700; font-size: 15px; flex: 0 0 auto; }
.net-ic.down { background: color-mix(in srgb, var(--success) 14%, transparent); color: var(--success); }
.net-ic.up { background: color-mix(in srgb, var(--danger) 14%, transparent); color: var(--danger); }
.net-lab { font-size: 13px; color: var(--muted); }
.net-val { margin-left: auto; font-size: 17px; font-weight: 700; color: var(--fg); font-variant-numeric: tabular-nums; }
.net-unit { font-size: 11px; font-weight: 600; color: var(--muted); font-style: normal; margin-left: 2px; }

/* 网络流量卡：底部用双趋势图+峰值填满空白 */
.cell-net.dash-card { display: flex; flex-direction: column; }
.net-footer { margin-top: auto; padding-top: 14px; }
.net-foot-hd { display: flex; align-items: center; justify-content: space-between; margin-bottom: 4px; }
.net-foot-lab { font-size: 12px; color: var(--muted); }
.net-foot-stat { font-size: 12px; font-weight: 600; }
.net-foot-stat.down { color: #10b981; }
.net-foot-stat.up { color: #f97316; }

@media (max-width: 1100px) {
  .cell-kpi, .cell-docker { grid-column: span 6; }
  .cell-trend, .cell-donut, .cell-net { grid-column: span 12; }
}
@media (max-width: 680px) {
  .cell-kpi, .cell-docker, .cell-trend, .cell-donut, .cell-net, .cell-list { grid-column: span 12; }
}
</style>
