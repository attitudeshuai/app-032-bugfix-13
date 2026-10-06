<script setup lang="ts">
/** 裁片图：实线为裁切线，绿色虚线为净样（缝份折线，跟随当前缝份），标注尺寸与对位标记 */
import { computed } from 'vue'
import type { Panel } from '../core/types'
import { panelCircle, panelCutBox, panelCutPoints, panelNetPoints } from '../core/panels'

const props = defineProps<{ panel: Panel; showMarks?: boolean; showDims?: boolean }>()

const box = computed(() => panelCutBox(props.panel))
const cutW = computed(() => box.value.wMm)
const cutH = computed(() => box.value.hMm)
const pad = 22
const viewBox = computed(() => `${-pad} ${-pad} ${cutW.value + pad * 2} ${cutH.value + pad * 2}`)
const fs = computed(() => Math.max(3, Math.min(8, Math.max(cutW.value, cutH.value) / 26)))
const sw = computed(() => Math.max(0.25, Math.max(cutW.value, cutH.value) / 420))

const sy = (y: number) => cutH.value - y

// 裁切线与净样线同源于 core/panels（与 1:1 图纸是同一份结论）
const cutPts = computed(() => panelCutPoints(props.panel))
const netPts = computed(() => panelNetPoints(props.panel))
const cutCircle = computed(() => panelCircle(props.panel, false))
const netCircle = computed(() => panelCircle(props.panel, true))

const markList = computed(() =>
  (props.panel.marksMm || []).map((m, i) => ({ ...m, n: i + 1, cx: m.x, cy: sy(m.y) }))
)

/** 净尺寸说明（按形状给出净样关键尺寸，与裁片页「展开净尺寸」行一致） */
const netCaption = computed(() => {
  const p = props.panel
  if (p.shape === 'circle' && !p.polySides) return `净 ⌀${p.rawWidthTopMm.toFixed(1)}`
  if (p.shape === 'circle' && p.polySides) {
    return `净对边距 ${p.rawWidthTopMm.toFixed(1)}（正${p.polySides}边形）`
  }
  return `净 上${p.rawWidthTopMm.toFixed(1)}/下${p.rawWidthBottomMm.toFixed(1)}×高${p.rawHeightMm.toFixed(1)}`
})
</script>

<template>
  <svg class="panel-svg" :viewBox="viewBox" preserveAspectRatio="xMidYMid meet">
    <!-- 裁切线 -->
    <polygon
      v-if="cutPts"
      :points="cutPts"
      fill="rgba(179,36,31,0.06)"
      stroke="#b3241f"
      :stroke-width="sw * 1.6"
    />
    <circle
      v-if="cutCircle"
      :cx="cutCircle.cx"
      :cy="cutCircle.cy"
      :r="cutCircle.r"
      fill="rgba(179,36,31,0.06)"
      stroke="#b3241f"
      :stroke-width="sw * 1.6"
    />

    <!-- 净样（缝份折到背面后的净尺寸线），绿色虚线，跟随当前缝份 -->
    <polygon
      v-if="netPts"
      :points="netPts"
      fill="none"
      stroke="#2f7a63"
      :stroke-width="sw * 1.2"
      stroke-dasharray="4 2.5"
    />
    <circle
      v-if="netCircle"
      :cx="netCircle.cx"
      :cy="netCircle.cy"
      :r="netCircle.r"
      fill="none"
      stroke="#2f7a63"
      :stroke-width="sw * 1.2"
      stroke-dasharray="4 2.5"
    />

    <!-- 对位标记 -->
    <g v-if="showMarks !== false" class="marks">
      <g v-for="m in markList" :key="m.n">
        <line :x1="m.cx - 3" :x2="m.cx + 3" :y1="m.cy" :y2="m.cy" />
        <line :x1="m.cx" :x2="m.cx" :y1="m.cy - 3" :y2="m.cy + 3" />
        <circle :cx="m.cx" :cy="m.cy" r="2.2" />
        <text :x="m.cx + 4.4" :y="m.cy - 3.6" :font-size="fs * 0.85">{{ m.n }}</text>
      </g>
    </g>

    <!-- 尺寸标注 -->
    <g v-if="showDims !== false" class="dims">
      <line :x1="(cutW - panel.widthTopMm) / 2" :x2="(cutW + panel.widthTopMm) / 2" :y1="-9" :y2="-9" />
      <text :x="cutW / 2" :y="-11.5" text-anchor="middle" :font-size="fs">
        上宽 {{ panel.widthTopMm.toFixed(1) }}
      </text>

      <line :x1="(cutW - panel.widthBottomMm) / 2" :x2="(cutW + panel.widthBottomMm) / 2" :y1="cutH + 9" :y2="cutH + 9" />
      <text :x="cutW / 2" :y="cutH + 9 + fs * 1.3" text-anchor="middle" :font-size="fs">
        下宽 {{ panel.widthBottomMm.toFixed(1) }}
      </text>

      <line :x1="-9" :x2="-9" :y1="0" :y2="cutH" />
      <text
        :x="-12"
        :y="cutH / 2"
        text-anchor="middle"
        :font-size="fs"
        :transform="`rotate(-90 -12 ${cutH / 2})`"
      >
        高 {{ cutH.toFixed(1) }}
      </text>
    </g>

    <text :x="cutW / 2" :y="cutH / 2 + fs * 0.5" text-anchor="middle" :font-size="fs * 1.05" class="net-label">
      {{ netCaption }} + 缝份 {{ panel.seamAllowanceMm }}×2
    </text>
  </svg>
</template>

<style scoped>
.panel-svg {
  width: 100%;
  height: auto;
  display: block;
  max-height: 340px;
}

.marks line {
  stroke: #2f5f8a;
  stroke-width: 0.5;
}

.marks circle {
  fill: none;
  stroke: #2f5f8a;
  stroke-width: 0.5;
}

.marks text {
  fill: #2f5f8a;
}

.dims line {
  stroke: #2f5f8a;
  stroke-width: 0.5;
}

.dims text {
  fill: #2f5f8a;
}

.net-label {
  fill: rgba(60, 30, 20, 0.45);
}
</style>
