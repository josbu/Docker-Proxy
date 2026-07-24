<template>
  <svg
    class="sparkline"
    :viewBox="`0 0 ${w} ${h}`"
    preserveAspectRatio="none"
    :style="{ height: height + 'px' }"
  >
    <defs>
      <linearGradient :id="gid" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" :stop-color="color" stop-opacity="0.35" />
        <stop offset="100%" :stop-color="color" stop-opacity="0" />
      </linearGradient>
    </defs>
    <path v-if="areaPath" :d="areaPath" :fill="`url(#${gid})`" />
    <path
      v-if="linePath"
      :d="linePath"
      :stroke="color"
      fill="none"
      stroke-width="2.5"
      stroke-linecap="round"
      stroke-linejoin="round"
    />
  </svg>
</template>

<script setup>
import { computed } from 'vue'

const props = defineProps({
  data: { type: Array, default: () => [] },
  color: { type: String, default: '#3b82f6' },
  height: { type: Number, default: 32 }
})

const w = 120
const h = props.height
const pad = 3
const gid = 'spark-' + Math.random().toString(36).slice(2, 9)

const points = computed(() => {
  const arr = (props.data || []).map(v => Number(v)).filter(v => isFinite(v))
  if (!arr.length) return []
  const min = Math.min(...arr)
  const max = Math.max(...arr)
  const range = max - min || 1
  // 只有 1 个点时画一条水平中线，避免空白
  if (arr.length === 1) {
    return [
      [0, h / 2],
      [w, h / 2]
    ]
  }
  return arr.map((v, i) => {
    const x = (i / (arr.length - 1)) * w
    const y = h - pad - ((v - min) / range) * (h - pad * 2)
    return [x, y]
  })
})

const linePath = computed(() => {
  if (!points.value.length) return ''
  return 'M' + points.value.map(p => p.join(',')).join(' L')
})

const areaPath = computed(() => {
  if (!linePath.value) return ''
  return `${linePath.value} L${w},${h} L0,${h} Z`
})
</script>

<style scoped>
.sparkline {
  display: block;
  width: 100%;
}
</style>
