<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue';
import type { ChartSeries } from '../statistics-types';

const props = withDefaults(defineProps<{
  title: string;
  labels: string[];
  axisLabels?: string[];
  series: ChartSeries[];
  unit?: string;
  type?: 'bar' | 'line';
  selectable?: boolean;
}>(), { type: 'bar', unit: '次', selectable: false });
const emit = defineEmits<{ select: [index: number] }>();
const active = ref<number | null>(null);
watch(() => props.labels, () => { active.value = null; });
const width = ref(640), surface = ref<HTMLElement | null>(null);
const height = 244, left = 40, right = 14, top = 18, bottom = 36;
const plotWidth = computed(() => width.value - left - right), plotHeight = height - top - bottom;
const observer = new ResizeObserver(entries => { width.value = Math.max(240, Math.round(entries[0].contentRect.width)); });
onMounted(() => { if (surface.value) observer.observe(surface.value); });
onUnmounted(() => observer.disconnect());
const maximum = computed(() => {
  const rawStep = Math.max(1, ...props.series.flatMap(series => series.values)) / 4;
  const scale = 10 ** Math.floor(Math.log10(rawStep));
  const normalized = rawStep / scale;
  let tickStep = (normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10) * scale;
  if (props.unit === '项／次' || props.unit === '次') tickStep = Math.max(1, Math.ceil(tickStep));
  return tickStep * 4;
});
const ticks = computed(() => Array.from({ length: 5 }, (_, i) => maximum.value * i / 4));
const tickLabel = (value: number) => props.unit === 'Token' && value >= 10000
  ? new Intl.NumberFormat('zh-CN', { notation: 'compact', maximumFractionDigits: 1 }).format(value)
  : Number(value.toFixed(1));
const step = computed(() => plotWidth.value / Math.max(1, props.labels.length));
const x = (i: number) => left + (i + 0.5) * step.value;
const y = (value: number) => top + plotHeight * (1 - value / maximum.value);
const barWidth = computed(() => Math.min(24, step.value * 0.68 / Math.max(1, props.series.length)));
const points = (series: ChartSeries) => series.values.map((value, i) => `${x(i)},${y(value)}`).join(' ');
const area = (series: ChartSeries) => `${x(0)},${y(0)} ${points(series)} ${x(series.values.length - 1)},${y(0)}`;
const labelIndices = computed(() => {
  const every = Math.max(1, Math.ceil(props.labels.length / Math.max(2, Math.floor(plotWidth.value / 68))));
  const last = props.labels.length - 1;
  const indices = props.labels.map((_, i) => i).filter(i => i % every === 0 && last - i >= every);
  return [...indices, last].filter(i => i >= 0);
});
const hasValues = computed(() => props.series.some(series => series.values.some(value => value > 0)));
function select(i: number) { if (props.selectable) emit('select', i); }
</script>

<template>
  <div class="statistics-chart">
    <div class="statistics-legend">
      <span v-for="series in props.series" :key="series.label"><i :style="{ background: series.color }"></i>{{ series.label }}</span>
      <span class="chart-unit">单位：{{ unit }}</span>
    </div>
    <div ref="surface" class="statistics-chart-scroll">
      <svg :viewBox="`0 0 ${width} ${height}`" role="group" :aria-label="title" @mouseleave="active = null">
        <title>{{ title }}</title>
        <g v-for="tick in ticks" :key="tick">
          <line :x1="left" :x2="width - right" :y1="y(tick)" :y2="y(tick)" class="chart-grid-line" />
          <text :x="left - 9" :y="y(tick) + 4" text-anchor="end" class="chart-axis-text">{{ tickLabel(tick) }}</text>
        </g>
        <rect v-if="active !== null" :x="left + active * step" :y="top" :width="step" :height="plotHeight" fill="var(--stats-hover)" opacity="0.7" pointer-events="none" />
        <template v-if="type === 'line'">
          <g v-for="series in props.series" :key="series.label">
            <polygon :points="area(series)" :fill="series.color" opacity="0.09" />
            <polyline :points="points(series)" :stroke="series.color" fill="none" stroke-width="2.5" stroke-linejoin="round" />
          </g>
        </template>
        <g v-for="(label, index) in labels" :key="index" :role="selectable ? 'button' : 'img'"
          tabindex="0" :aria-label="`${label}，${series.map(s => `${s.label} ${s.values[index]} ${unit}`).join('，')}${selectable ? '，查看任务' : ''}`"
          :class="{ 'chart-selectable': selectable }" @mouseenter="active = index" @focus="active = index"
          @blur="active = null" @click="select(index)" @keydown.enter.prevent="select(index)" @keydown.space.prevent="select(index)">
          <rect :x="left + index * step" :y="top" :width="step" :height="plotHeight" fill="transparent" />
          <template v-for="(series, seriesIndex) in props.series" :key="series.label">
            <rect v-if="type === 'bar'" :x="x(index) + (seriesIndex - props.series.length / 2) * barWidth"
              :y="y(series.values[index] || 0)" :width="Math.max(1, barWidth - 2)" :height="y(0) - y(series.values[index] || 0)"
              :fill="series.color" rx="2" />
            <circle v-else :cx="x(index)" :cy="y(series.values[index] || 0)" :r="active === index ? 5 : 3" :fill="series.color" />
          </template>
        </g>
        <text v-for="index in labelIndices" :key="index" :x="x(index)" :y="height - 10" text-anchor="middle" class="chart-axis-text">{{ axisLabels?.[index] || labels[index] }}</text>
      </svg>
    </div>
    <div class="chart-readout" aria-live="polite">
      <template v-if="active !== null"><strong>{{ labels[active] }}</strong><span v-for="series in props.series" :key="series.label">{{ series.label }} {{ series.values[active] }} {{ unit }}</span></template>
      <template v-else>{{ hasValues ? (selectable ? '悬停查看数值，点击图表查看对应任务。' : '悬停或通过键盘查看每个时间点。') : '这段时间暂无记录，图表已保留完整时间轴。' }}</template>
    </div>
    <details class="chart-table"><summary>查看图表数据</summary><div class="chart-table-scroll"><table><thead><tr><th>日期／分类</th><th v-for="series in props.series" :key="series.label">{{ series.label }}（{{ unit }}）</th></tr></thead><tbody><tr v-for="(label, index) in labels" :key="index"><td>{{ label }}</td><td v-for="series in props.series" :key="series.label">{{ series.values[index] }}</td></tr></tbody></table></div></details>
  </div>
</template>
