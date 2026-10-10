<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue';
import { api } from '../api';
import { useAuth } from '../stores/auth';
import { localDate, useTasks } from '../stores/tasks';
import type { Task } from '../types';
import type { Statistics } from '../statistics-types';
import StatisticsChart from './StatisticsChart.vue';
import PeriodReportsPanel from './PeriodReportsPanel.vue';

const emit = defineEmits<{ open: [task: Task] }>();
const view = ref('overview');
const auth = useAuth(), tasks = useTasks();
const timezone = computed(() => auth.user?.timezone || 'Asia/Shanghai');
const today = () => localDate(timezone.value);
const shift = (day: string, offset: number) => {
  const date = new Date(day + 'T00:00:00Z');
  date.setUTCDate(date.getUTCDate() + offset);
  return date.toISOString().slice(0, 10);
};
const end = ref(today()), start = ref(shift(end.value, -29));
const preset = ref('30'), busy = ref(false), error = ref('');
const data = ref<Statistics | null>(null), projects = ref<{ id: string; title: string }[]>([]);
const limit = ref(10), now = ref(Date.now());
const clock = window.setInterval(() => { now.value = Date.now(); }, 60000);
let generation = 0;
onUnmounted(() => { generation++; clearInterval(clock); });

const colors = { green: 'var(--stats-green)', blue: 'var(--stats-blue)', amber: 'var(--stats-amber)',
  gray: 'var(--stats-gray)', red: 'var(--stats-red)' };
const scopes = [{ key: 'work', label: '工作', color: colors.green }, { key: 'life', label: '生活', color: colors.blue },
  { key: 'study', label: '学习', color: colors.amber },
  { key: 'unassigned', label: '未分类', color: colors.gray }];
const statuses = [{ key: 'todo', label: '待办', color: colors.gray }, { key: 'doing', label: '进行中', color: colors.blue },
  { key: 'done', label: '完成', color: colors.green }, { key: 'failed', label: '失败', color: colors.red },
  { key: 'cancelled', label: '取消', color: colors.amber }];
const priorities = [{ key: 'high', label: '高优先级', color: colors.red }, { key: 'mid', label: '中优先级', color: colors.amber },
  { key: 'low', label: '低优先级', color: colors.green }];

type Selection = { kind: 'scope' | 'range' | 'completionPriority' | 'status' | 'priority' | 'project' | 'risk'; value: string; label: string; end?: string };
const selection = ref<Selection | null>(null);
const currentSelection = computed(() => selection.value && !['scope', 'range', 'completionPriority'].includes(selection.value.kind));
const activeTasks = computed(() => tasks.items.filter(task => ['todo', 'doing'].includes(task.status)));
function overdue(task: Task) {
  return ['todo', 'doing'].includes(task.status) && Boolean(
    (task.due_date && task.due_date < localDate(timezone.value)) || (task.due_at && Date.parse(task.due_at) < now.value));
}
const overdueTasks = computed(() => { void now.value; return tasks.items.filter(overdue); });
const scopeRows = computed(() => scopes.map(scope => ({ ...scope, count: data.value?.scopes[scope.key] || 0 })));
const totalCompletions = computed(() => data.value?.summary.completion_events || 0);
const ring = computed(() => {
  if (!totalCompletions.value) return 'var(--stats-track)';
  let offset = 0;
  return `conic-gradient(${scopeRows.value.map(row => {
    const from = offset; offset += row.count / totalCompletions.value * 100;
    return `${row.color} ${from}% ${offset}%`;
  }).join(',')})`;
});
const stateRows = computed(() => statuses.map(state => ({ ...state, count: tasks.items.filter(task => task.status === state.key).length })));
const priorityRows = computed(() => priorities.map(priority => ({ ...priority, count: activeTasks.value.filter(task => task.priority === priority.key).length })));
const completedPriorityRows = computed(() => priorities.map(priority => ({ ...priority, count: data.value?.completion_priorities[priority.key] || 0 })));
const maxState = computed(() => Math.max(1, ...stateRows.value.map(row => row.count)));
const maxPriority = computed(() => Math.max(1, ...priorityRows.value.map(row => row.count)));
const maxCompletedPriority = computed(() => Math.max(1, ...completedPriorityRows.value.map(row => row.count)));
const projectRows = computed(() => {
  const groups = new Map<string, { key: string; title: string; total: number; done: number; active: number; other: number }>();
  for (const task of tasks.items) {
    const key = task.project_id || '';
    let group = groups.get(key);
    if (!group) {
      group = { key, title: projects.value.find(project => project.id === key)?.title || (key ? '已移除项目' : '未分配项目'), total: 0, done: 0, active: 0, other: 0 };
      groups.set(key, group);
    }
    group.total++;
    if (task.status === 'done') group.done++;
    else if (['todo', 'doing'].includes(task.status)) group.active++;
    else group.other++;
  }
  return [...groups.values()].sort((a, b) => b.total - a.total || a.title.localeCompare(b.title));
});

// Long periods use honest sums, retaining exact bucket dates for drill-down.
const bucketSize = computed(() => (data.value?.daily.length || 0) > 120 ? 30 : (data.value?.daily.length || 0) > 31 ? 7 : 1);
const buckets = computed(() => {
  const days = data.value?.daily || [];
  const result = [];
  for (let i = 0; i < days.length; i += bucketSize.value) {
    const group = days.slice(i, i + bucketSize.value);
    result.push({ start: group[0].date, end: group[group.length - 1].date,
      label: group[0].date.slice(5).replace('-', '/'),
      completed: group.reduce((sum, day) => sum + day.completed, 0),
      created: group.reduce((sum, day) => sum + day.created, 0),
      minutes: Math.round(group.reduce((sum, day) => sum + day.focus_seconds, 0) / 60 * 10) / 10 });
  }
  return result;
});
const trendSeries = computed(() => [{ label: '完成次数', color: colors.green, values: buckets.value.map(day => day.completed) },
  { label: '新增任务', color: colors.blue, values: buckets.value.map(day => day.created) }]);
const focusSeries = computed(() => [{ label: '专注时长', color: colors.green, values: buckets.value.map(day => day.minutes) }]);
const weekdays = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'];
const rhythmSeries = computed(() => {
  const totals = new Array<number>(7).fill(0), counts = new Array<number>(7).fill(0);
  for (const day of data.value?.daily || []) {
    const i = (new Date(day.date + 'T00:00:00Z').getUTCDay() + 6) % 7;
    totals[i] += day.completed; counts[i]++;
  }
  return [{ label: '平均完成次数', color: colors.green, values: totals.map((total, i) => counts[i] ? Math.round(total / counts[i] * 10) / 10 : 0) }];
});

const metrics = computed(() => {
  if (!data.value) return [];
  const s = data.value.summary, p = data.value.previous;
  return [{ label: '期间完成任务', value: s.completed_tasks, unit: '项', change: s.completed_tasks - p.completed_tasks },
    { label: '期间新增任务', value: s.created_tasks, unit: '项', change: s.created_tasks - p.created_tasks },
    { label: '期间专注分钟', value: Math.round(s.focus_seconds / 60), unit: '分钟', change: Math.round((s.focus_seconds - p.focus_seconds) / 60) },
    { label: '当前逾期任务', value: overdueTasks.value.length, unit: '项', change: null }];
});
const insight = computed(() => {
  if (!data.value) return '';
  const s = data.value.summary;
  if (!s.completion_events && !s.created_tasks && !s.focus_seconds) return '这段时间还没有活动记录。记录任务、完成事项或开始专注后，这里会展示你的节奏。';
  return `这段时间完成了 ${s.completed_tasks} 项任务，新增 ${s.created_tasks} 项，记录了 ${Math.round(s.focus_seconds / 60)} 分钟专注。${overdueTasks.value.length ? `当前有 ${overdueTasks.value.length} 项逾期任务，可以先看看这些事项。` : '当前没有逾期的待办任务。'}`;
});
const completionRecords = computed(() => (data.value?.completed || []).filter(record => {
  const selected = selection.value;
  if (selected?.kind === 'scope') return record.scope === selected.value;
  if (selected?.kind === 'completionPriority') return record.priority === selected.value;
  if (selected?.kind === 'range') return record.date >= selected.value && record.date <= (selected.end || selected.value);
  return true;
}));
const selectedTasks = computed(() => tasks.items.filter(task => {
  const selected = selection.value;
  if (selected?.kind === 'status') return task.status === selected.value;
  if (selected?.kind === 'priority') return ['todo', 'doing'].includes(task.status) && task.priority === selected.value;
  if (selected?.kind === 'project') return (task.project_id || '') === selected.value;
  if (selected?.kind === 'risk') return overdue(task);
  return false;
}));
const recordCount = computed(() => currentSelection.value ? selectedTasks.value.length : completionRecords.value.length);
const detail = ref<HTMLElement | null>(null);
async function select(selected: Selection | null) {
  selection.value = selected; limit.value = 10;
  await nextTick(); detail.value?.scrollIntoView({ block: 'start', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
}
function selectBucket(index: number) {
  const bucket = buckets.value[index];
  void select({ kind: 'range', value: bucket.start, end: bucket.end,
    label: bucket.start === bucket.end ? `${bucket.start} 完成记录` : `${bucket.start} 至 ${bucket.end} 完成记录` });
}
function dateTime(value: string) {
  return new Intl.DateTimeFormat('zh-CN', { timeZone: timezone.value, month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).format(new Date(value));
}

async function load() {
  if (busy.value) return;
  const ticket = ++generation;
  error.value = '';
  const days = (Date.parse(end.value) - Date.parse(start.value)) / 86400000;
  if (!start.value || !end.value || !Number.isFinite(days) || days < 0 || days > 366) {
    error.value = '请选择有效的起止日期，结束日期不能早于开始日期，范围须在一年内。'; return;
  }
  busy.value = true;
  try {
    const [statistics, projectList] = await Promise.all([
      api<Statistics>('/statistics?' + new URLSearchParams({ start: start.value, end: end.value })),
      api<{ id: string; title: string }[]>('/projects'),
      tasks.refresh(today()),
    ]);
    if (ticket === generation) { data.value = statistics; projects.value = projectList; selection.value = null; limit.value = 10; }
  } catch (e) { if (ticket === generation) error.value = (e as Error).message; }
  finally { if (ticket === generation) busy.value = false; }
}
async function choosePreset(value: string) {
  preset.value = value; end.value = today();
  start.value = value === 'month' ? end.value.slice(0, 8) + '01' : shift(end.value, -(Number(value) - 1));
  await load();
}
watch(() => tasks.items.map(task => `${task.id}:${task.version}`).join(','), () => { if (data.value && !busy.value) void load(); });
onMounted(load);
</script>

<template>
  <nav class="statistics-tabs" aria-label="统计视图"><button :aria-current="view === 'overview' ? 'page' : undefined" @click="view = 'overview'">统计概览</button><button :aria-current="view === 'reports' ? 'page' : undefined" @click="view = 'reports'">周报与月报</button></nav>
  <PeriodReportsPanel v-if="view === 'reports'" />
  <section v-show="view === 'overview'" class="feature-page statistics-page" :aria-busy="busy">
    <div class="statistics-intro"><div><p class="page-description">把完成的事、投入的时间和待处理的任务放在一起看。</p></div><span class="statistics-period-badge">{{ data ? `${data.start} — ${data.end}` : '正在读取统计' }}</span></div>
    <div class="statistics-toolbar">
      <div class="statistics-presets" role="group" aria-label="统计时间快捷选择">
        <button v-for="option in [{ value: '7', label: '近 7 天' }, { value: '30', label: '近 30 天' }, { value: 'month', label: '本月' }, { value: '90', label: '近 90 天' }]" :key="option.value" type="button" :aria-pressed="preset === option.value" :disabled="busy" @click="choosePreset(option.value)">{{ option.label }}</button>
      </div>
      <form class="statistics-dates" @submit.prevent="load">
        <label><span class="sr-only">统计开始日期</span><input type="date" v-model="start" aria-label="统计开始日期" required @input="preset = ''" /></label>
        <span aria-hidden="true">至</span>
        <label><span class="sr-only">统计结束日期</span><input type="date" v-model="end" aria-label="统计结束日期" required @input="preset = ''" /></label>
        <el-button native-type="submit" :disabled="busy">{{ busy ? '更新中…' : '更新统计' }}</el-button>
      </form>
    </div>
    <el-alert v-if="error" :title="error" type="error" :closable="false" show-icon />
    <p v-if="!data && !error" class="statistics-loading" role="status">正在汇总任务与专注记录…</p>
    <template v-if="data">
      <div class="statistics-metrics">
        <article v-for="metric in metrics" :key="metric.label"><span>{{ metric.label }}</span><p><strong>{{ metric.value }}</strong><small>{{ metric.unit }}</small></p><span v-if="metric.change !== null" class="metric-comparison">较上期 {{ metric.change > 0 ? '+' : '' }}{{ metric.change }} {{ metric.unit }}</span><button v-else class="statistics-text-button" @click="select({ kind: 'risk', value: '', label: '当前逾期任务' })">查看逾期任务 →</button></article>
      </div>
      <p class="statistics-comparison-period">对比上期 {{ data.previous.start }} 至 {{ data.previous.end }}；当前逾期任务不受所选日期范围影响。</p>
      <div class="statistics-insight"><span>这段时间</span><p>{{ insight }}</p></div>

      <div class="statistics-section-heading"><h2>期间表现</h2><span>{{ bucketSize === 1 ? '按日展示' : `每 ${bucketSize} 天汇总展示` }}</span></div>
      <div class="statistics-chart-grid">
        <article class="statistics-panel statistics-panel-wide"><header><div><h3>完成与新增</h3><p>看每天的任务流入与完成节奏</p></div><span>{{ data.summary.completion_events }} 次完成</span></header><StatisticsChart title="完成与新增趋势图" :labels="buckets.map(day => day.label)" :series="trendSeries" unit="项／次" selectable @select="selectBucket" /></article>
        <article class="statistics-panel"><header><div><h3>专注投入</h3><p>累计投入 {{ Math.round(data.summary.focus_seconds / 60) }} 分钟</p></div></header><StatisticsChart title="专注时长趋势图" :labels="buckets.map(day => day.label)" :series="focusSeries" type="line" unit="分钟" /></article>
        <article class="statistics-panel"><header><div><h3>分类分布</h3><p>按完成时的任务分类统计</p></div></header><div class="statistics-donut-layout"><div class="statistics-donut" :style="{ background: ring }" role="img" :aria-label="`完成范围分布：${scopeRows.map(row => `${row.label} ${row.count} 次`).join('，')}`"><div><strong>{{ totalCompletions }}</strong><span>次完成</span></div></div><div class="statistics-donut-legend"><button v-for="row in scopeRows" :key="row.key" @click="select({ kind: 'scope', value: row.key, label: `${row.label}完成记录` })"><i :style="{ background: row.color }"></i><span>{{ row.label }}</span><strong>{{ row.count }}</strong><small>{{ totalCompletions ? Math.round(row.count / totalCompletions * 100) : 0 }}%</small></button></div></div><p class="statistics-panel-note">{{ totalCompletions ? '点击分类查看完成记录。' : '暂无完成记录，完成任务后会显示分类占比。' }}</p></article>
        <article class="statistics-panel"><header><div><h3>一周节奏</h3><p>按星期比较日均完成次数，包含零记录的日期</p></div></header><StatisticsChart title="每周完成节奏图" :labels="weekdays" :series="rhythmSeries" unit="次／天" /></article>
        <article class="statistics-panel"><header><div><h3>完成任务优先级</h3><p>按完成时的优先级统计完成次数</p></div></header><div class="statistics-bars" role="group" aria-label="完成任务优先级分布图"><button v-for="row in completedPriorityRows" :key="row.key" :aria-label="`${row.label}完成 ${row.count} 次，查看记录`" @click="select({ kind: 'completionPriority', value: row.key, label: `${row.label}完成记录` })"><span>{{ row.label }}</span><div class="statistics-bar-track"><div :style="{ width: `${row.count / maxCompletedPriority * 100}%`, background: row.color }"></div></div><strong>{{ row.count }}</strong></button></div><p class="statistics-panel-note">点击条形查看对应的完成记录。</p></article>
      </div>

      <div class="statistics-section-heading"><h2>当前任务状态</h2><span>全部有效任务 · {{ tasks.items.length }} 项</span></div>
      <div class="statistics-chart-grid">
        <article class="statistics-panel"><header><div><h3>状态分布</h3><p>完成、失败与取消分别展示</p></div></header><div class="statistics-bars" role="group" aria-label="当前任务状态分布图"><button v-for="row in stateRows" :key="row.key" :aria-label="`${row.label} ${row.count} 项，查看任务`" @click="select({ kind: 'status', value: row.key, label: `当前${row.label}任务` })"><span>{{ row.label }}</span><div class="statistics-bar-track"><div :style="{ width: `${row.count / maxState * 100}%`, background: row.color }"></div></div><strong>{{ row.count }}</strong></button></div></article>
        <article class="statistics-panel"><header><div><h3>待处理优先级</h3><p>待办与进行中 · {{ activeTasks.length }} 项</p></div></header><div class="statistics-bars" role="group" aria-label="待处理任务优先级分布图"><button v-for="row in priorityRows" :key="row.key" :aria-label="`${row.label} ${row.count} 项，查看任务`" @click="select({ kind: 'priority', value: row.key, label: `${row.label}待处理任务` })"><span>{{ row.label }}</span><div class="statistics-bar-track"><div :style="{ width: `${row.count / maxPriority * 100}%`, background: row.color }"></div></div><strong>{{ row.count }}</strong></button></div><p class="statistics-panel-note">点击条形查看对应的待处理任务。</p></article>
        <article class="statistics-panel statistics-panel-wide"><header><div><h3>项目进度</h3><p>各项目当前已完成任务的比例</p></div></header><div class="statistics-legend"><span><i :style="{ background: colors.green }"></i>完成</span><span><i :style="{ background: colors.blue }"></i>待办／进行中</span><span><i :style="{ background: colors.gray }"></i>失败／取消</span></div><div class="statistics-projects" role="group" aria-label="项目任务进度图"><button v-for="row in projectRows" :key="row.key" :aria-label="`${row.title}，完成 ${row.done} 项，共 ${row.total} 项，查看任务`" @click="select({ kind: 'project', value: row.key, label: `${row.title}任务` })"><div><strong>{{ row.title }}</strong><span>{{ row.done }} / {{ row.total }} 项 · {{ Math.round(row.done / row.total * 100) }}%</span></div><div class="statistics-stacked-track"><span :style="{ width: `${row.done / row.total * 100}%`, background: colors.green }"></span><span :style="{ width: `${row.active / row.total * 100}%`, background: colors.blue }"></span><span :style="{ width: `${row.other / row.total * 100}%`, background: colors.gray }"></span></div></button><p v-if="!projectRows.length" class="statistics-panel-note">还没有任务，创建后会显示项目进度。</p></div></article>
      </div>

      <section ref="detail" class="statistics-details"><header><div><h2>{{ selection?.label || '完成记录' }}</h2><span>{{ recordCount }} {{ currentSelection ? '项任务' : '条记录' }}</span></div><button v-if="selection" class="statistics-text-button" @click="select(null)">清除筛选</button></header>
        <template v-if="currentSelection"><button v-for="task in selectedTasks.slice(0, limit)" :key="task.id" class="statistics-task-row" @click="emit('open', task)"><span><strong>{{ task.title }}</strong><small>{{ statuses.find(state => state.key === task.status)?.label }} · {{ scopes.find(scope => scope.key === task.scope)?.label }}{{ task.due_date ? ` · 截止 ${task.due_date}` : task.due_at ? ` · 截止 ${dateTime(task.due_at)}` : '' }}</small></span><span>查看 →</span></button></template>
        <template v-else><router-link v-for="record in completionRecords.slice(0, limit)" :key="record.event_id" :to="'/history?task=' + record.task_id" class="statistics-task-row"><span><strong>{{ record.title }}</strong><small>{{ dateTime(record.occurred_at) }} · {{ scopes.find(scope => scope.key === record.scope)?.label || '未分类' }}</small></span><span>历史 →</span></router-link></template>
        <p v-if="!recordCount" class="statistics-empty">{{ currentSelection ? '当前没有符合条件的任务。' : '这段时间没有符合条件的完成记录。' }}</p><el-button v-if="recordCount > limit" text @click="limit += 10">查看更多（还有 {{ recordCount - limit }} 条）</el-button>
      </section>
      <details class="help-disclosure statistics-method"><summary>统计口径与说明</summary><p>期间完成任务按任务去重；完成趋势和分类分布按完成事件计数，同一任务重新打开后再次完成会增加一次记录。导入记录只有真实完成时间才计入；已删除任务与未采纳建议不计入任务数量及完成统计。</p><p>专注记录单独汇总，时长按会话开始日期归属，取消的会话不计入。日期使用账户时区 {{ timezone }}。对比上期是紧邻所选范围之前、天数相同的时间段。</p><p>状态、待处理优先级、项目进度与逾期是当前快照，不受日期筛选影响。项目完成比例为完成任务数除以项目全部有效任务数，失败与取消不算完成。</p></details>
    </template>
  </section>
</template>
