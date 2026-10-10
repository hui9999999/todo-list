<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { api, post } from '../api';
import { useAuth } from '../stores/auth';
import { localDate } from '../stores/tasks';
import type { Statistics, PeriodSummary } from '../statistics-types';
import StatisticsChart from './StatisticsChart.vue';

type Kind = 'weekly' | 'monthly';
interface ReportItem { id: string; kind: Kind; start: string; end: string; partial: boolean; generated_at: string; source: string; timezone: string; summary: PeriodSummary }
interface Report extends Omit<ReportItem, 'summary'> { content: Omit<Statistics, 'states' | 'start' | 'end'> & {
  active_days: number; insights: string[]; advice: string;
  carryover: { task_id: string; title: string; due: string; priority: string }[];
} }
interface Schedule { weekly_enabled: boolean; monthly_enabled: boolean; weekly_next: string; monthly_next: string; timezone: string; time: string; version: number }
const auth = useAuth();
const today = () => localDate(auth.user?.timezone || 'Asia/Shanghai');
const kind = ref<Kind>('weekly'), date = ref(today());
const items = ref<ReportItem[]>([]), report = ref<Report | null>(null), schedule = ref<Schedule | null>(null);
const loading = ref(true), generating = ref(false), reading = ref(false), saving = ref(false), error = ref(''), notice = ref('');
const hasMore = ref(false), completedLimit = ref(10), carryoverLimit = ref(5);
const busy = computed(() => loading.value || generating.value || reading.value);
const green = 'var(--stats-green)', blue = 'var(--stats-blue)';
function shift(day: string, days: number) { const d = new Date(day + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + days); return d.toISOString().slice(0, 10); }
const range = computed(() => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date.value) || !Number.isFinite(Date.parse(date.value))) return null;
  if (kind.value === 'weekly') {
    const start = shift(date.value, -((new Date(date.value + 'T00:00:00Z').getUTCDay() + 6) % 7));
    return { start, end: shift(start, 6) };
  }
  const start = date.value.slice(0, 8) + '01';
  const d = new Date(start + 'T00:00:00Z'); d.setUTCMonth(d.getUTCMonth() + 1);
  return { start, end: shift(d.toISOString().slice(0, 10), -1) };
});
const summary = computed(() => report.value?.content.summary);
const metrics = computed(() => {
  if (!summary.value || !report.value) return [];
  const s = summary.value, p = report.value.content.previous;
  return [{ label: '完成任务', value: s.completed_tasks, unit: '项', delta: s.completed_tasks - p.completed_tasks },
    { label: '新增任务', value: s.created_tasks, unit: '项', delta: s.created_tasks - p.created_tasks },
    { label: '专注时长', value: Math.round(s.focus_seconds / 60), unit: '分钟', delta: Math.round((s.focus_seconds - p.focus_seconds) / 60) },
    { label: '活跃日期', value: report.value.content.active_days, unit: '天', delta: null }];
});
const daily = computed(() => report.value?.content.daily || []);
const trend = computed(() => [{ label: '完成次数', color: green, values: daily.value.map(day => day.completed) },
  { label: '新增任务', color: blue, values: daily.value.map(day => day.created) }]);
const focus = computed(() => [{ label: '专注时长', color: green, values: daily.value.map(day => Math.round(day.focus_seconds / 60 * 10) / 10) }]);
const scopes = [{ key: 'work', label: '工作' }, { key: 'life', label: '生活' }, { key: 'study', label: '学习' }, { key: 'unassigned', label: '未分类' }];
const scopeSeries = computed(() => [{ label: '完成次数', color: blue, values: scopes.map(scope => report.value?.content.scopes[scope.key] || 0) }]);
const completions = computed(() => {
  const rows = new Map<string, { task_id: string; title: string; scope: string; count: number }>();
  for (const record of report.value?.content.completed || []) {
    const existing = rows.get(record.task_id);
    if (existing) existing.count++;
    else rows.set(record.task_id, { ...record, count: 1 });
  }
  return [...rows.values()];
});
function label(row: { kind: Kind; start: string; end: string }) { return row.kind === 'monthly' ? `${row.start.slice(0, 7)} 月报` : `${row.start} — ${row.end} 周报`; }
function timestamp(row: Report) { return new Intl.DateTimeFormat('zh-CN', { timeZone: row.timezone, dateStyle: 'short', timeStyle: 'short' }).format(new Date(row.generated_at)); }
async function list(append = false) {
  const result = await api<{ items: ReportItem[]; has_more: boolean }>('/period-reports?offset=' + (append ? items.value.length : 0));
  items.value = append ? [...items.value, ...result.items] : result.items; hasMore.value = result.has_more;
}
async function select(id: string) {
  reading.value = true; error.value = ''; notice.value = '';
  try { report.value = await api<Report>('/period-reports/' + id); completedLimit.value = 10; carryoverLimit.value = 5; }
  catch (e) { error.value = (e as Error).message; }
  finally { reading.value = false; }
}
async function load() {
  loading.value = true; error.value = '';
  try {
    const [settings] = await Promise.all([api<Schedule>('/period-reports/schedule'), list()]);
    schedule.value = settings;
    if (items.value.length) await select(items.value[0].id);
  } catch (e) { error.value = (e as Error).message; }
  finally { loading.value = false; }
}
async function generate() {
  if (busy.value || !range.value) return;
  generating.value = true; error.value = ''; notice.value = '';
  try {
    report.value = await post<Report>('/period-reports', { kind: kind.value, date: date.value });
    completedLimit.value = 10; carryoverLimit.value = 5;
    await list(); notice.value = '报告已生成并保存';
  } catch (e) { error.value = (e as Error).message; }
  finally { generating.value = false; }
}
async function saveSchedule(key: 'weekly_enabled' | 'monthly_enabled', value: boolean) {
  if (!schedule.value || saving.value) return;
  saving.value = true; error.value = '';
  try {
    schedule.value = await api<Schedule>('/period-reports/schedule', { method: 'PUT', body: JSON.stringify({
      weekly_enabled: schedule.value.weekly_enabled, monthly_enabled: schedule.value.monthly_enabled,
      [key]: value, version: schedule.value.version,
    }) });
  } catch (e) { error.value = (e as Error).message; schedule.value = await api<Schedule>('/period-reports/schedule').catch(() => schedule.value); }
  finally { saving.value = false; }
}
function choosePeriod(which: 'current' | 'previous') {
  date.value = today();
  if (which === 'previous' && range.value) date.value = shift(range.value.start, -1);
}
async function more() { loading.value = true; try { await list(true); } catch (e) { error.value = (e as Error).message; } finally { loading.value = false; } }
async function copy() {
  if (!report.value || !summary.value) return;
  const r = report.value;
  const text = [`# ${label(r)}`, `${r.partial ? '截至目前 · ' : ''}${r.start} 至 ${r.end}（${r.timezone}）`,
    ...r.content.insights, '', '## 完成事项', ...completions.value.map(task => `- ${task.title}（${scopes.find(scope => scope.key === task.scope)?.label || '未分类'}${task.count > 1 ? `，完成 ${task.count} 次` : ''}）`),
    '', '## 后续安排', r.content.advice, ...r.content.carryover.map(task => `- ${task.title}（截止 ${task.due}）`)].join('\n');
  try { await navigator.clipboard.writeText(text); notice.value = '已复制报告'; }
  catch { error.value = '复制失败，请检查浏览器剪贴板权限'; }
}
onMounted(load);
</script>

<template>
  <section class="feature-page statistics-page reports-page" :aria-busy="busy">
    <div class="report-automation" v-if="schedule">
      <div><strong>自动生成</strong><p>每周一 {{ schedule.time }} 生成上周周报，每月 1 日 {{ schedule.time }} 生成上月月报 · {{ schedule.timezone }}</p></div>
      <div class="report-switches"><label><span>周报</span><el-switch :model-value="schedule.weekly_enabled" :disabled="saving" aria-label="自动周报" @change="value => saveSchedule('weekly_enabled', Boolean(value))" /></label><label><span>月报</span><el-switch :model-value="schedule.monthly_enabled" :disabled="saving" aria-label="自动月报" @change="value => saveSchedule('monthly_enabled', Boolean(value))" /></label></div>
    </div>
    <form class="report-generator" @submit.prevent="generate">
      <div class="statistics-presets" role="group" aria-label="报告类型"><button type="button" :aria-pressed="kind === 'weekly'" :disabled="busy" @click="kind = 'weekly'">周报</button><button type="button" :aria-pressed="kind === 'monthly'" :disabled="busy" @click="kind = 'monthly'">月报</button></div>
      <label class="report-date"><span>{{ kind === 'weekly' ? '选择周内日期' : '选择月份' }}</span><input v-if="kind === 'weekly'" type="date" v-model="date" aria-label="报告日期" :max="today()" :disabled="busy" required /><input v-else type="month" :value="date.slice(0, 7)" @input="date = ($event.target as HTMLInputElement).value + '-01'" aria-label="报告月份" :max="today().slice(0, 7)" :disabled="busy" required /></label>
      <div class="report-period-shortcuts"><button type="button" :disabled="busy" @click="choosePeriod('current')">{{ kind === 'weekly' ? '本周' : '本月' }}</button><button type="button" :disabled="busy" @click="choosePeriod('previous')">{{ kind === 'weekly' ? '上周' : '上月' }}</button></div>
      <el-button type="primary" native-type="submit" :loading="generating" :disabled="busy || !range || range.start > today()">生成{{ kind === 'weekly' ? '周报' : '月报' }}</el-button>
      <p v-if="range" class="report-range">{{ range.start }} 至 {{ range.end }}{{ range.end >= today() ? ' · 截至目前' : '' }}</p>
    </form>
    <el-alert v-if="error" :title="error" type="error" :closable="false" show-icon />
    <p v-if="notice" class="report-notice" role="status">{{ notice }}</p>
    <p v-if="loading && !items.length && !report" class="statistics-loading" role="status">正在读取报告…</p>
    <div class="report-workspace" v-if="items.length || report">
      <aside class="report-history" aria-label="报告历史"><h2>历史报告</h2><div class="report-history-items"><button v-for="item in items" :key="item.id" type="button" :aria-pressed="report?.id === item.id" :disabled="busy" @click="select(item.id)"><strong>{{ item.kind === 'monthly' ? item.start.slice(0, 7) + ' 月报' : item.start + ' 周报' }}</strong><span>{{ item.partial ? '截至目前' : item.source === 'auto' ? '自动生成' : '手动生成' }} · 完成 {{ item.summary.completed_tasks }} 项</span></button></div><el-button v-if="hasMore" text :disabled="busy" @click="more">更早的报告</el-button><el-button text :disabled="busy" @click="load">刷新报告</el-button></aside>
      <article class="report-detail" v-if="report">
        <header class="report-heading"><div><h2>{{ label(report) }}</h2><p>{{ report.partial ? '截至目前 · ' : '' }}{{ timestamp(report) }} 生成 · {{ report.source === 'auto' ? '自动' : '手动' }} · {{ report.timezone }}</p></div><el-button :disabled="busy" @click="copy">复制报告</el-button></header>
        <div class="statistics-metrics"><article v-for="metric in metrics" :key="metric.label"><span>{{ metric.label }}</span><p><strong>{{ metric.value }}</strong><small>{{ metric.unit }}</small></p><span v-if="metric.delta !== null" class="metric-comparison">较上期 {{ metric.delta > 0 ? '+' : '' }}{{ metric.delta }} {{ metric.unit }}</span></article></div>
        <p class="statistics-comparison-period">对比 {{ report.content.previous.start }} 至 {{ report.content.previous.end }}{{ report.partial ? '（上一周期同期）' : '（上一完整周期）' }}。</p>
        <section class="report-review"><h3>本期复盘</h3><p v-for="insight in report.content.insights" :key="insight">{{ insight }}</p></section>
        <div class="statistics-chart-grid">
          <section class="statistics-panel statistics-panel-wide"><header><h3>完成与新增</h3></header><StatisticsChart title="报告完成与新增趋势图" :labels="daily.map(day => day.date.slice(5))" :series="trend" unit="项／次" /></section>
          <section class="statistics-panel"><header><h3>专注投入</h3></header><StatisticsChart title="报告专注时长图" :labels="daily.map(day => day.date.slice(5))" :series="focus" type="line" unit="分钟" /></section>
          <section class="statistics-panel"><header><h3>完成分类</h3></header><StatisticsChart title="报告完成分类图" :labels="scopes.map(scope => scope.label)" :series="scopeSeries" unit="次" /></section>
        </div>
        <section class="report-task-section"><header><h3>完成事项</h3><span>{{ summary?.completed_tasks }} 项 · {{ summary?.completion_events }} 次完成</span></header><div v-for="task in completions.slice(0, completedLimit)" :key="task.task_id" class="report-task"><strong>{{ task.title }}</strong><span>{{ scopes.find(scope => scope.key === task.scope)?.label || '未分类' }}{{ task.count > 1 ? ` · ${task.count} 次完成` : '' }}</span></div><p v-if="!completions.length" class="statistics-empty">{{ summary?.completed_tasks ? '相关任务明细已永久删除，保留生成时的汇总。' : '本期暂无完成事项。' }}</p><el-button v-if="completions.length > completedLimit" text @click="completedLimit += 10">查看更多完成事项</el-button></section>
        <section class="report-task-section"><header><h3>后续安排</h3></header><p class="report-advice">{{ report.content.advice }}</p><div v-for="task in report.content.carryover.slice(0, carryoverLimit)" :key="task.task_id" class="report-task"><strong>{{ task.title }}</strong><span>{{ task.priority === 'high' ? '高优先级 · ' : '' }}截止 {{ task.due }}</span></div><el-button v-if="report.content.carryover.length > carryoverLimit" text @click="carryoverLimit += 5">查看更多待处理事项</el-button></section>
        <p class="report-method">报告为生成时保存的快照，任务变化后可重新生成同一周期。完成任务按任务去重，趋势与分类按完成次数统计；取消的专注不计入时长。后续安排反映生成时的未完成任务。</p>
      </article>
    </div>
    <div v-else-if="!loading && !error" class="report-empty"><h2>还没有报告</h2><p>选择一周或一个月，生成第一份复盘。开启自动生成后，新报告会保存在这里。</p></div>
  </section>
</template>
