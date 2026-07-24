<template>
  <div class="page ipa-page">
    <!-- 页面标题 -->
    <header class="ipa-header">
      <div class="ipa-header__main">
        <div class="ipa-header__badge">
          <el-icon><Lock /></el-icon>
        </div>
        <div class="ipa-header__text">
          <h1>{{ t('ipAccess.title') }}</h1>
          <p>{{ t('ipAccess.subtitle') }}</p>
        </div>
      </div>
      <div class="ipa-header__actions">
        <el-tag
          :type="statusTagType"
          effect="dark"
          size="large"
          class="status-tag"
        >
          <span class="status-tag__inner">
            <el-icon class="status-tag__icon"><component :is="statusTagIcon" /></el-icon>
            <span>{{ statusTagLabel }}</span>
          </span>
        </el-tag>
        <el-button
          :loading="loading"
          class="head-btn"
          @click="load"
        >
          <el-icon><Refresh /></el-icon>
          <span>{{ t('common.refresh') }}</span>
        </el-button>
        <el-button
          type="primary"
          :loading="saving"
          class="head-btn head-btn--primary"
          @click="onSave"
        >
          <el-icon><Document /></el-icon>
          <span>{{ t('common.save') }}</span>
        </el-button>
      </div>
    </header>

    <!-- 说明横幅 -->
    <div class="info-banner">
      <div class="info-banner__icon">
        <el-icon><InfoFilled /></el-icon>
      </div>
      <div class="info-banner__body">
        <div class="info-banner__title">{{ t('ipAccess.howItWorks') }}</div>
        <div class="info-banner__desc">{{ t('ipAccess.howItWorksDesc') }}</div>
      </div>
    </div>

    <!-- 白名单风险提示 -->
    <el-alert
      v-if="form.mode === 'whitelist'"
      class="ipa-warning"
      type="warning"
      :closable="false"
      show-icon
      :title="t('ipAccess.whitelistWarn')"
    />

    <!-- 工作模式选择 -->
    <section class="ipa-section">
      <div class="section-title">
        <span class="section-title__bar" />
        <span>{{ t('ipAccess.modeTitle') }}</span>
      </div>
      <div class="mode-grid">
        <div
          v-for="m in modeOptions"
          :key="m.value"
          class="mode-card"
          :class="{ active: form.mode === m.value }"
          tabindex="0"
          role="radio"
          :aria-checked="form.mode === m.value"
          @click="form.mode = m.value"
          @keydown.space.prevent="form.mode = m.value"
        >
          <div class="mode-card__radio">
            <div class="radio-dot" :class="{ checked: form.mode === m.value }" />
          </div>
          <div class="mode-card__icon" :class="`mode-${m.value}`">
            <el-icon><component :is="m.icon" /></el-icon>
          </div>
          <div class="mode-card__content">
            <div class="mode-card__title">{{ m.label }}</div>
            <div class="mode-card__desc">{{ m.desc }}</div>
          </div>
        </div>
      </div>
    </section>

    <!-- 关闭模式下的空状态 -->
    <div v-if="form.mode === 'off'" class="empty-state">
      <div class="empty-state__orb">
        <el-icon><Unlock /></el-icon>
      </div>
      <div class="empty-state__title">{{ t('ipAccess.emptyTip') }}</div>
    </div>

    <!-- 白名单 / 黑名单编辑 -->
    <section v-else class="ipa-section lists-section">
      <div class="section-title">
        <span class="section-title__bar" />
        <span>{{ t('ipAccess.modeTitle') }}</span>
      </div>
      <div class="lists-grid">
        <!-- 白名单 -->
        <el-card
          shadow="never"
          class="list-card"
          :class="{ active: form.mode === 'whitelist', dimmed: form.mode === 'blacklist' }"
        >
          <div class="list-card__header">
            <div class="list-card__title">
              <span class="list-card__icon list-card__icon--allow"><el-icon><CircleCheck /></el-icon></span>
              <span>{{ t('ipAccess.whitelist') }}</span>
            </div>
            <el-tag
              :type="form.mode === 'whitelist' ? 'success' : 'info'"
              effect="plain"
              size="small"
              round
            >
              {{ form.mode === 'whitelist' ? t('ipAccess.applied') : t('ipAccess.notApplied') }}
            </el-tag>
          </div>
          <div class="list-card__count">{{ t('ipAccess.ruleCount', { count: form.whitelist.length }) }}</div>
          <el-select
            v-model="form.whitelist"
            multiple
            filterable
            allow-create
            default-first-option
            :reserve-keyword="false"
            class="ipa-select"
            :class="{ disabled: form.mode !== 'whitelist' }"
            :placeholder="t('ipAccess.placeholder')"
            :disabled="form.mode !== 'whitelist'"
            @blur="normalizeList(form.whitelist)"
          >
            <el-option v-for="ip in form.whitelist" :key="ip" :label="ip" :value="ip" />
          </el-select>
          <p class="list-hint">{{ t('ipAccess.hint') }}</p>
        </el-card>

        <!-- 黑名单 -->
        <el-card
          shadow="never"
          class="list-card"
          :class="{ active: form.mode === 'blacklist', dimmed: form.mode === 'whitelist' }"
        >
          <div class="list-card__header">
            <div class="list-card__title">
              <span class="list-card__icon list-card__icon--deny"><el-icon><CircleClose /></el-icon></span>
              <span>{{ t('ipAccess.blacklist') }}</span>
            </div>
            <el-tag
              :type="form.mode === 'blacklist' ? 'danger' : 'info'"
              effect="plain"
              size="small"
              round
            >
              {{ form.mode === 'blacklist' ? t('ipAccess.applied') : t('ipAccess.notApplied') }}
            </el-tag>
          </div>
          <div class="list-card__count">{{ t('ipAccess.ruleCount', { count: form.blacklist.length }) }}</div>
          <el-select
            v-model="form.blacklist"
            multiple
            filterable
            allow-create
            default-first-option
            :reserve-keyword="false"
            class="ipa-select"
            :class="{ disabled: form.mode !== 'blacklist' }"
            :placeholder="t('ipAccess.placeholder')"
            :disabled="form.mode !== 'blacklist'"
            @blur="normalizeList(form.blacklist)"
          >
            <el-option v-for="ip in form.blacklist" :key="ip" :label="ip" :value="ip" />
          </el-select>
          <p class="list-hint">{{ t('ipAccess.hint') }}</p>
        </el-card>
      </div>
    </section>
  </div>
</template>

<script setup>
import { ref, reactive, computed, onMounted } from 'vue'
import { ElMessage } from 'element-plus'
import {
  Refresh, Document, Lock, InfoFilled, Unlock,
  CircleCheck, CircleClose
} from '@element-plus/icons-vue'
import { getIpAccess, saveIpAccess } from '../services'
import { useI18n } from 'vue-i18n'

const { t } = useI18n()

const loading = ref(false)
const saving = ref(false)

const form = reactive({
  mode: 'off',
  whitelist: [],
  blacklist: []
})

const modeOptions = computed(() => [
  { value: 'off', label: t('ipAccess.modeOff'), desc: t('ipAccess.descOff'), icon: Unlock },
  { value: 'whitelist', label: t('ipAccess.modeWhitelist'), desc: t('ipAccess.descWhitelist'), icon: CircleCheck },
  { value: 'blacklist', label: t('ipAccess.modeBlacklist'), desc: t('ipAccess.descBlacklist'), icon: CircleClose }
])

const statusTagType = computed(() => {
  if (form.mode === 'whitelist') return 'success'
  if (form.mode === 'blacklist') return 'danger'
  return 'info'
})

const statusTagIcon = computed(() => {
  if (form.mode === 'whitelist') return CircleCheck
  if (form.mode === 'blacklist') return CircleClose
  return Unlock
})

const statusTagLabel = computed(() => {
  if (form.mode === 'whitelist') return t('ipAccess.modeWhitelist')
  if (form.mode === 'blacklist') return t('ipAccess.modeBlacklist')
  return t('ipAccess.modeOff')
})

function normalizeList(list) {
  const seen = new Set()
  const out = []
  for (const raw of list) {
    const v = String(raw).trim()
    if (!v) continue
    const key = v.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push(v)
  }
  list.length = 0
  list.push(...out)
}

async function load() {
  loading.value = true
  try {
    const c = await getIpAccess()
    form.mode = c.mode || 'off'
    form.whitelist = Array.isArray(c.whitelist) ? c.whitelist.slice() : []
    form.blacklist = Array.isArray(c.blacklist) ? c.blacklist.slice() : []
  } catch (e) {
    ElMessage.error(t('ipAccess.loadFailed') + (e.response?.data?.error || e.message))
  } finally {
    loading.value = false
  }
}

async function onSave() {
  normalizeList(form.whitelist)
  normalizeList(form.blacklist)
  saving.value = true
  try {
    await saveIpAccess({
      mode: form.mode,
      whitelist: form.whitelist,
      blacklist: form.blacklist
    })
    ElMessage.success(t('ipAccess.saved'))
    await load()
  } catch (e) {
    const d = e.response?.data || {}
    ElMessage.error((t('ipAccess.saveFailed')) + (d.error || e.message))
  } finally {
    saving.value = false
  }
}

onMounted(load)
</script>

<style scoped>
.ipa-page {
  color: var(--fg);
  padding-bottom: 24px;
}

/* 顶部标题 */
.ipa-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 20px;
}
.ipa-header__main {
  display: flex;
  align-items: center;
  gap: 16px;
}
.ipa-header__badge {
  width: 52px;
  height: 52px;
  border-radius: 14px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 26px;
  color: #fff;
  background: linear-gradient(135deg, #3b82f6 0%, #06b6d4 100%);
  box-shadow: 0 8px 22px rgba(59, 130, 246, .28);
  flex-shrink: 0;
}
.ipa-header__text h1 {
  margin: 0 0 4px;
  font-size: 22px;
  font-weight: 700;
  color: var(--fg);
  letter-spacing: -.01em;
}
.ipa-header__text p {
  margin: 0;
  font-size: 13px;
  color: var(--muted);
  line-height: 1.5;
}
.ipa-header__actions {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
  justify-content: flex-end;
}
.status-tag {
  font-weight: 600;
  font-size: 13px;
  padding: 0 12px;
  height: 34px;
}
.status-tag__inner {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  line-height: 1;
}
.status-tag__icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 14px;
  line-height: 1;
}
.head-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-weight: 500;
}
.head-btn .el-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  margin-right: 5px;
  line-height: 1;
  vertical-align: middle;
}
.head-btn > span {
  line-height: 1;
}
.head-btn--primary {
  box-shadow: 0 4px 14px rgba(59, 130, 246, .35);
}

/* 说明横幅 */
.info-banner {
  display: flex;
  align-items: flex-start;
  gap: 14px;
  background: var(--bg-card);
  border: 1px solid var(--border);
  border-radius: 12px;
  padding: 16px 18px;
  margin-bottom: 18px;
  box-shadow: var(--shadow-card);
  position: relative;
  overflow: hidden;
}
.info-banner::before {
  content: '';
  position: absolute;
  left: 0;
  top: 0;
  bottom: 0;
  width: 4px;
  background: linear-gradient(180deg, var(--accent), var(--accent-2));
}
.info-banner__icon {
  width: 36px;
  height: 36px;
  border-radius: 10px;
  background: var(--accent-soft);
  color: var(--accent);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 18px;
  flex-shrink: 0;
}
.info-banner__body {
  flex: 1;
  min-width: 0;
  padding-left: 4px;
}
.info-banner__title {
  font-weight: 600;
  font-size: 14px;
  color: var(--fg);
  margin-bottom: 4px;
}
.info-banner__desc {
  font-size: 12.5px;
  color: var(--muted);
  line-height: 1.6;
}

/* 白名单风险提示 */
.ipa-warning {
  margin-bottom: 18px;
  border-radius: 10px;
}

/* 分区标题 */
.ipa-section {
  margin-bottom: 18px;
}
.section-title {
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 15px;
  font-weight: 700;
  color: var(--fg);
  margin-bottom: 14px;
}
.section-title__bar {
  width: 4px;
  height: 18px;
  border-radius: 2px;
  background: linear-gradient(180deg, var(--accent), var(--accent-2));
}

/* 模式卡片 */
.mode-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 14px;
}
.mode-card {
  position: relative;
  display: flex;
  align-items: flex-start;
  gap: 14px;
  background: var(--bg-card);
  border: 1.5px solid var(--border);
  border-radius: 14px;
  padding: 18px;
  cursor: pointer;
  transition: all .2s cubic-bezier(.22, .61, .36, 1);
  box-shadow: var(--shadow-card);
  outline: none;
}
.mode-card:hover {
  border-color: var(--border-strong);
  transform: translateY(-2px);
  box-shadow: var(--shadow-hover);
}
.mode-card.active {
  border-color: var(--accent);
  background: linear-gradient(135deg, var(--bg-card) 0%, var(--accent-soft) 100%);
  box-shadow: 0 4px 18px rgba(59, 130, 246, .14);
}
.mode-card__radio {
  position: absolute;
  top: 16px;
  right: 16px;
}
.radio-dot {
  width: 18px;
  height: 18px;
  border-radius: 50%;
  border: 2px solid var(--border-strong);
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all .2s ease;
}
.radio-dot::after {
  content: '';
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: #fff;
  transform: scale(0);
  transition: transform .18s ease;
}
.radio-dot.checked {
  border-color: var(--accent);
  background: var(--accent);
}
.radio-dot.checked::after {
  transform: scale(1);
}
.mode-card__icon {
  width: 44px;
  height: 44px;
  border-radius: 12px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 22px;
  flex-shrink: 0;
}
.mode-card__icon.mode-off {
  background: #f1f5f9;
  color: #64748b;
}
.mode-card__icon.mode-whitelist {
  background: rgba(22, 163, 74, .12);
  color: var(--success);
}
.mode-card__icon.mode-blacklist {
  background: rgba(220, 38, 38, .12);
  color: var(--danger);
}
.mode-card__content {
  flex: 1;
  min-width: 0;
  padding-right: 24px;
}
.mode-card__title {
  font-size: 15px;
  font-weight: 700;
  color: var(--fg);
  margin-bottom: 5px;
}
.mode-card__desc {
  font-size: 12.5px;
  color: var(--muted);
  line-height: 1.55;
}

/* 关闭模式空状态 */
.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 52px 24px;
  background: var(--bg-card);
  border: 1px dashed var(--border);
  border-radius: 16px;
  text-align: center;
}
.empty-state__orb {
  width: 80px;
  height: 80px;
  border-radius: 50%;
  background: var(--bg-card-2);
  color: var(--muted-2);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 36px;
  margin-bottom: 16px;
}
.empty-state__title {
  font-size: 14px;
  color: var(--muted);
  max-width: 420px;
  line-height: 1.6;
}

/* 名单编辑 */
.lists-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 16px;
}
.list-card {
  background: var(--bg-card);
  border: 1.5px solid var(--border);
  border-radius: 14px;
  transition: all .2s ease;
}
.list-card.active {
  border-color: var(--accent);
  box-shadow: 0 4px 18px rgba(59, 130, 246, .1);
}
.list-card.dimmed {
  opacity: .72;
  filter: grayscale(.25);
}
.list-card :deep(.el-card__body) {
  padding: 18px;
}
.list-card__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  margin-bottom: 10px;
}
.list-card__title {
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 15px;
  font-weight: 700;
  color: var(--fg);
}
.list-card__icon {
  width: 32px;
  height: 32px;
  border-radius: 8px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 16px;
}
.list-card__icon--allow {
  background: rgba(22, 163, 74, .12);
  color: var(--success);
}
.list-card__icon--deny {
  background: rgba(220, 38, 38, .12);
  color: var(--danger);
}
.list-card__count {
  font-size: 12px;
  color: var(--muted);
  margin-bottom: 12px;
}
.ipa-select {
  width: 100%;
}
.ipa-select.disabled :deep(.el-select__wrapper) {
  background: var(--bg-card-2);
  cursor: not-allowed;
}
.list-hint {
  margin: 10px 0 0;
  font-size: 12px;
  color: var(--muted-2);
  line-height: 1.5;
}

/* 响应式 */
@media (max-width: 980px) {
  .ipa-header {
    flex-direction: column;
    align-items: flex-start;
  }
  .ipa-header__actions {
    width: 100%;
    justify-content: flex-start;
  }
  .mode-grid { grid-template-columns: 1fr; }
  .lists-grid { grid-template-columns: 1fr; }
}
@media (max-width: 640px) {
  .ipa-header__main {
    align-items: flex-start;
  }
  .ipa-header__badge {
    width: 44px;
    height: 44px;
    font-size: 22px;
  }
  .ipa-header__text h1 {
    font-size: 19px;
  }
  .ipa-header__actions {
    flex-direction: column;
    align-items: stretch;
  }
  .status-tag { justify-content: center; }
  .head-btn { width: 100%; justify-content: center; }
}
</style>
