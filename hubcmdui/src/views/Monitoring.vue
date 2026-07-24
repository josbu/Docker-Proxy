<template>
  <div class="page mon-page">
    <div class="page-head mon-head">
      <div class="head-badge"><el-icon><Monitor /></el-icon></div>
      <div class="head-text">
        <h2>{{ t('monitoring.title') }}</h2>
        <p class="muted">{{ t('monitoring.subtitle') }}</p>
      </div>
      <div class="head-actions">
        <el-button type="primary" :loading="saving" @click="onSave"><el-icon><Check /></el-icon> {{ t('monitoring.saveConfig') }}</el-button>
      </div>
    </div>

    <!-- 状态横幅 -->
    <div class="status-banner" :class="enabled ? 'on' : 'off'">
      <div class="sb-ico"><el-icon><Bell /></el-icon></div>
      <div class="sb-text">
        <div class="sb-title">{{ enabled ? t('monitoring.running') : t('monitoring.paused') }}</div>
        <div class="sb-sub">{{ t('monitoring.checkIntervalHint', { interval: form.monitorInterval, provider: providerName }) }}</div>
      </div>
      <el-switch
        v-model="enabled"
        :active-text="t('common.enabled')"
        :inactive-text="t('monitoring.disable')"
        inline-prompt
        :loading="toggling"
        @change="onToggle"
      />
    </div>

    <div class="mon-grid">
      <!-- 通知设置 -->
      <el-card shadow="never" class="section-card">
        <template #header>
          <div class="sec-head"><el-icon><Bell /></el-icon><span>{{ t('monitoring.notificationSettings') }}</span></div>
        </template>

        <div class="provider-label">{{ t('monitoring.notificationMethod') }}</div>
        <div class="provider-cards">
          <div
            class="provider-card"
            :class="{ active: form.notificationType === 'wechat' }"
            role="radio"
            :aria-checked="form.notificationType === 'wechat'"
            tabindex="0"
            @click="form.notificationType = 'wechat'"
            @keyup.enter="form.notificationType = 'wechat'"
          >
            <div class="pc-ico wechat"><el-icon><ChatDotRound /></el-icon></div>
            <div class="pc-name">{{ t('monitoring.wechat') }}</div>
            <div class="pc-desc">{{ t('monitoring.wechatDesc') }}</div>
            <el-icon v-if="form.notificationType === 'wechat'" class="pc-check"><CircleCheck /></el-icon>
          </div>

          <div
            class="provider-card"
            :class="{ active: form.notificationType === 'telegram' }"
            role="radio"
            :aria-checked="form.notificationType === 'telegram'"
            tabindex="0"
            @click="form.notificationType = 'telegram'"
            @keyup.enter="form.notificationType = 'telegram'"
          >
            <div class="pc-ico telegram"><el-icon><ChatLineRound /></el-icon></div>
            <div class="pc-name">Telegram</div>
            <div class="pc-desc">{{ t('monitoring.telegramDesc') }}</div>
            <el-icon v-if="form.notificationType === 'telegram'" class="pc-check"><CircleCheck /></el-icon>
          </div>
        </div>

        <el-form label-position="top" class="mon-form">
          <el-form-item v-show="form.notificationType === 'wechat'" label="Webhook">
            <el-input v-model="form.webhookUrl" placeholder="https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=...">
              <template #prefix><el-icon><Link /></el-icon></template>
            </el-input>
            <div class="field-hint">{{ t('monitoring.wechatHint') }}</div>
          </el-form-item>
          <el-form-item v-show="form.notificationType === 'telegram'" label="Bot Token">
            <el-input v-model="form.telegramToken" placeholder="123456:ABC-DEF1234..." />
            <div class="field-hint">{{ t('monitoring.telegramTokenHint') }}</div>
          </el-form-item>
          <el-form-item v-show="form.notificationType === 'telegram'" label="Chat ID">
            <el-input v-model="form.telegramChatId" :placeholder="t('monitoring.chatIdPlaceholder')" />
            <div class="field-hint">{{ t('monitoring.telegramChatIdHint') }}</div>
          </el-form-item>
        </el-form>
      </el-card>

      <!-- 监控规则 -->
      <el-card shadow="never" class="section-card">
        <template #header>
          <div class="sec-head"><el-icon><Timer /></el-icon><span>{{ t('monitoring.monitorRules') }}</span></div>
        </template>
        <el-form label-position="top" class="mon-form">
          <el-form-item :label="t('monitoring.checkInterval')">
            <el-input-number v-model="form.monitorInterval" :min="10" :max="3600" :step="10" controls-position="right" />
            <span class="unit">{{ t('monitoring.unitSecond') }}</span>
            <div class="field-hint">{{ t('monitoring.checkIntervalHint2') }}</div>
          </el-form-item>
        </el-form>

        <div class="traffic-divider" />

        <div class="traffic-head"><el-icon><DataLine /></el-icon> {{ t('monitoring.trafficAlertTitle') }}</div>
        <el-form label-position="top" class="mon-form">
          <el-form-item>
            <el-switch v-model="form.enableTrafficAlert" :active-text="t('common.enabled')" :inactive-text="t('monitoring.disable')" inline-prompt />
            <div class="field-hint">{{ t('monitoring.trafficAlertHint') }}</div>
          </el-form-item>
          <div class="traffic-grid" :class="{ disabled: !form.enableTrafficAlert }">
            <el-form-item :label="t('monitoring.rxThreshold')" class="traffic-field">
              <el-input-number v-model="form.rxRateThreshold" :min="0" :step="10" controls-position="right" />
              <span class="unit">MB/s</span>
              <div class="field-hint">{{ t('monitoring.noLimit') }}</div>
            </el-form-item>
            <el-form-item :label="t('monitoring.txThreshold')" class="traffic-field">
              <el-input-number v-model="form.txRateThreshold" :min="0" :step="10" controls-position="right" />
              <span class="unit">MB/s</span>
              <div class="field-hint">{{ t('monitoring.noLimit') }}</div>
            </el-form-item>
            <el-form-item :label="t('monitoring.dailyTotalThreshold')" class="traffic-field">
              <el-input-number v-model="form.dailyTrafficThreshold" :min="0" :step="50" controls-position="right" />
              <span class="unit">GB</span>
              <div class="field-hint">{{ t('monitoring.noLimit') }}</div>
            </el-form-item>
            <el-form-item :label="t('monitoring.singleIpThreshold')" class="traffic-field">
              <el-input-number v-model="form.singleIpDailyThreshold" :min="0" :step="10" controls-position="right" />
              <span class="unit">GB</span>
              <div class="field-hint">{{ t('monitoring.noLimitIp') }}</div>
            </el-form-item>
          </div>
        </el-form>

        <el-button class="test-btn" :loading="testing" @click="onTest">
          <el-icon><Promotion /></el-icon> {{ t('monitoring.sendTest') }}
        </el-button>
      </el-card>
    </div>

    <!-- 已停止的容器 -->
    <el-card shadow="never" class="section-card stopped">
      <template #header>
        <div class="sec-head">
          <el-icon><Warning /></el-icon><span>{{ t('monitoring.stoppedContainers') }}</span>
          <span v-if="stopped.length" class="count-badge">{{ stopped.length }}</span>
        </div>
      </template>
      <el-table :data="stopped" v-loading="loadingStopped" :empty-text="t('monitoring.emptyStopped')" class="admin-table">
        <el-table-column prop="name" :label="t('monitoring.colContainer')" min-width="200" />
        <el-table-column prop="image" :label="t('monitoring.colImage')" min-width="240" />
        <el-table-column :label="t('common.status')" width="120">
          <template #default>
            <el-tag type="info" effect="light" round>
              <el-icon><VideoPlay /></el-icon> {{ t('monitoring.colStatusStopped') }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column :label="t('common.actions')" width="120">
          <template #default="{ row }">
            <el-button size="small" type="primary" @click="restart(row.id)">
              <el-icon><VideoPlay /></el-icon> {{ t('monitoring.start') }}
            </el-button>
          </template>
        </el-table-column>
      </el-table>
    </el-card>
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue'
import { ElMessage } from 'element-plus'
import { useI18n } from 'vue-i18n'
import {
  Check, Monitor, Bell, CircleCheck, ChatDotRound, ChatLineRound, Link, Timer, Promotion, Warning, VideoPlay, DataLine
} from '@element-plus/icons-vue'
import { getMonitoringConfig, saveMonitoringConfig, toggleMonitoring, testNotification, getStoppedContainersForMonitor, startContainer } from '../services'

const { t } = useI18n()

const form = ref({
  notificationType: 'wechat', webhookUrl: '', telegramToken: '', telegramChatId: '', monitorInterval: 60,
  enableTrafficAlert: false,
  rxRateThreshold: 100,
  txRateThreshold: 100,
  dailyTrafficThreshold: 500,
  singleIpDailyThreshold: 100
})
const enabled = ref(false)
const saving = ref(false), toggling = ref(false), testing = ref(false)
const stopped = ref([]), loadingStopped = ref(false)

const providerName = computed(() => form.value.notificationType === 'wechat' ? t('monitoring.wechat') : 'Telegram')

// 把后端/网络错误翻译成用户能看懂的提示
function describeError(e, ctxKey) {
  const data = e?.response?.data
  const status = e?.response?.status
  const be = data?.error || data?.message
  if (be) {
    if (status === 400) return t('monitoring.errConfigInvalid', { ctx: t(ctxKey), msg: be })
    if (status === 401) return t('monitoring.errLoginExpired')
    if (status === 500) return t('monitoring.errFailed', { ctx: t(ctxKey), msg: be })
    return be
  }
  if (e?.message && /is not defined|is not a function/.test(e.message)) {
    return t('monitoring.errUnavailable', { ctx: t(ctxKey) })
  }
  if (!e?.response) return t('monitoring.errNetwork')
  return t('monitoring.errFailed', { ctx: t(ctxKey), msg: e.message || t('monitoring.unknownError') })
}

async function load() {
  try {
    const c = await getMonitoringConfig()
    form.value = { ...form.value, ...c }
    enabled.value = !!c.isEnabled
  } catch (e) { ElMessage.warning(describeError(e, 'monitoring.readConfig')) }
  loadStopped()
}
async function loadStopped() {
  loadingStopped.value = true
  try { stopped.value = await getStoppedContainersForMonitor() } catch (e) {}
  finally { loadingStopped.value = false }
}
async function onSave() {
  saving.value = true
  try { await saveMonitoringConfig({ ...form.value, isEnabled: enabled.value }); ElMessage.success(t('monitoring.configSaved')) }
  catch (e) { ElMessage.error(describeError(e, 'monitoring.saveConfig')) }
  finally { saving.value = false }
}
async function onToggle(val) {
  toggling.value = true
  try { await toggleMonitoring(val); ElMessage.success(val ? t('monitoring.monitorEnabled') : t('monitoring.monitorDisabled')) }
  catch (e) { ElMessage.error(describeError(e, 'monitoring.toggleMonitor')); enabled.value = !val }
  finally { toggling.value = false }
}
async function onTest() {
  if (testing.value) return
  testing.value = true
  try {
    await testNotification(form.value)
    ElMessage.success(t('monitoring.testSent', { provider: providerName.value }))
  }
  catch (e) { ElMessage.error(describeError(e, 'monitoring.sendTest')) }
  finally { testing.value = false }
}
async function restart(id) {
  try { await startContainer(id); ElMessage.success(t('monitoring.containerStarted')); loadStopped() }
  catch (e) { ElMessage.error(describeError(e, 'monitoring.startContainer')) }
}
onMounted(load)
</script>

<style scoped>
.mon-page { color: var(--fg); }
.page-head.mon-head { display: flex; align-items: center; gap: 14px; margin-bottom: 16px; }
.head-badge {
  width: 46px; height: 46px; flex: 0 0 auto;
  display: flex; align-items: center; justify-content: center;
  border-radius: 13px; color: #fff;
  background: linear-gradient(135deg, var(--accent), var(--accent-2));
  box-shadow: 0 8px 20px var(--accent-soft);
  font-size: 22px;
}
.head-text h2 { margin: 0 0 3px; font-size: 20px; letter-spacing: -0.01em; }
.head-text .muted { color: var(--muted); margin: 0; font-size: 13px; }
.head-actions { margin-left: auto; }

/* 状态横幅 */
.status-banner {
  display: flex; align-items: center; gap: 14px;
  padding: 16px 18px; border-radius: 14px;
  border: 1px solid var(--border); margin-bottom: 16px;
  background: var(--bg-card-2);
  transition: border-color .2s ease, background .2s ease;
}
.status-banner.on { border-color: color-mix(in srgb, var(--success) 40%, var(--border)); background: color-mix(in srgb, var(--success) 10%, var(--bg-card-2)); }
.status-banner.off { border-color: var(--border); }
.sb-ico { width: 42px; height: 42px; flex: 0 0 auto; border-radius: 12px; display: flex; align-items: center; justify-content: center; font-size: 20px; background: var(--bg-card); color: var(--accent); }
.status-banner.on .sb-ico { color: var(--success); }
.sb-text { flex: 1; min-width: 0; }
.sb-title { font-size: 15px; font-weight: 700; color: var(--fg); }
.sb-sub { font-size: 12px; color: var(--muted); margin-top: 2px; }

/* 分区网格 */
.mon-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin-bottom: 16px; }
.section-card { background: var(--bg-card); border-color: var(--border); }
:deep(.el-card) { background: var(--bg-card); border-color: var(--border); }
.sec-head { display: flex; align-items: center; gap: 8px; font-weight: 600; color: var(--fg); }
.sec-head .el-icon { color: var(--accent); }
.count-badge { margin-left: 6px; font-size: 12px; font-weight: 600; color: var(--muted); background: var(--bg-card-2); border: 1px solid var(--border); border-radius: 999px; padding: 0 8px; }

/* 通知方式卡片选择器 */
.provider-label { font-size: 13px; font-weight: 600; color: var(--fg-2); margin-bottom: 10px; }
.provider-cards { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-bottom: 18px; }
.provider-card {
  position: relative; cursor: pointer;
  border: 1.5px solid var(--border); border-radius: 12px;
  padding: 14px; background: var(--bg-card-2);
  transition: border-color .18s ease, background .18s ease, transform .18s ease, box-shadow .18s ease;
}
.provider-card:hover { transform: translateY(-2px); border-color: var(--border-strong); }
.provider-card.active { border-color: var(--accent); background: var(--accent-soft); box-shadow: 0 6px 16px var(--accent-soft); }
.provider-card:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
.pc-ico { width: 38px; height: 38px; border-radius: 10px; display: flex; align-items: center; justify-content: center; font-size: 20px; color: #fff; margin-bottom: 10px; }
.pc-ico.wechat { background: #07c160; }
.pc-ico.telegram { background: #229ed9; }
.pc-name { font-size: 14px; font-weight: 700; color: var(--fg); }
.pc-desc { font-size: 12px; color: var(--muted); margin-top: 2px; }
.pc-check { position: absolute; top: 10px; right: 10px; color: var(--accent); font-size: 18px; }

/* 表单：与上方 provider-card 内容区左右对齐（卡片内边距 14px） */
.mon-form { margin-top: 4px; padding: 0 14px; }
.mon-form :deep(.el-form-item__label) {
  font-size: 12px;
  font-weight: 600;
  color: var(--fg-2);
  padding-bottom: 4px;
}
.field-hint { font-size: 12px; color: var(--muted); line-height: 1.5; margin-top: 4px; }
.unit { margin-left: 8px; color: var(--muted); font-size: 13px; }
.test-btn { width: calc(100% - 28px); margin: 14px 14px 0; }

.traffic-divider { height: 1px; background: var(--border); margin: 6px 14px 14px; }
.traffic-head { display: flex; align-items: center; gap: 7px; font-size: 14px; font-weight: 600; color: var(--fg); margin: 0 14px 10px; }
.traffic-head .el-icon { color: var(--accent); }
.traffic-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 0 16px; }
.traffic-grid.disabled { opacity: .55; pointer-events: none; }
.traffic-field :deep(.el-form-item__content) { flex-wrap: wrap; align-items: center; }
.traffic-field .unit { margin-left: 8px; color: var(--muted); font-size: 13px; }
.traffic-field .field-hint { width: 100%; margin-top: 5px; font-size: 12px; color: var(--muted); line-height: 1.5; }

.stopped { margin-top: 0; }

@media (max-width: 880px) {
  .mon-grid { grid-template-columns: 1fr; }
}
@media (prefers-reduced-motion: reduce) {
  .provider-card, .status-banner { transition: none; }
  .provider-card:hover { transform: none; }
}
</style>
