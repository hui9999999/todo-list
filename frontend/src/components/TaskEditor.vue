<script setup lang="ts">
import { computed, ref, watch } from "vue";
import type { Task, TaskFields, Scope, TaskEvent } from "../types";
import type { RecurrenceSettings } from '../advanced-types';
import { fieldsOf, localDate } from "../stores/tasks";
import { dateTimeInZone, dateTimeToISO, defaultDeadline } from '../task-deadline';
import { api, post } from "../api";
import {ElMessage,ElMessageBox} from 'element-plus';
import {useTasks} from '../stores/tasks';
import { workflowFor, dependencyMessage } from '../task-workflow';
import FailureReasonInput from './FailureReasonInput.vue';
const props = defineProps<{
  modelValue: boolean;
  task: Task | null;
  parent: Task | null;
  scope: Scope;
  automaticScope?: boolean;
  initialRecurrence?: boolean;
  busy: boolean;
  readonly?: boolean;
  timezone: string;
}>();
const emit = defineEmits<{
  "update:modelValue": [value: boolean];
  save: [fields: TaskFields, automaticScope: boolean, recurrence: RecurrenceSettings | null];
}>();
const form = ref<TaskFields>(blank()),
  events = ref<TaskEvent[]>([]),
  historyError = ref(""),
  historyBusy = ref(false);
const advancedOpen = ref(false);
const dueKind = ref("none"),
  dateValue = ref(""),
  timeValue = ref("");
const defaultTime = new Date(2000, 0, 1, 23, 59);
const repeat = ref<RecurrenceSettings['frequency'] | 'none'>('none');
const recurrence = ref<RecurrenceSettings>({frequency:'daily', interval:1, mode:'calendar', start_date:localDate(props.timezone)});
const recurring = computed(() => !props.task && !props.parent && repeat.value !== 'none');
const scheduleKind = computed({
  get: () => recurring.value ? 'repeat' : dueKind.value,
  set: (kind: string) => {
    if (kind === 'repeat') repeat.value = repeat.value === 'none' ? 'daily' : repeat.value;
    else { repeat.value = 'none'; dueKind.value = kind; }
  },
});
const deadlinePopperOptions = {
  modifiers: [{ name: 'preventOverflow', options: { rootBoundary: 'viewport', altAxis: true, tether: false, padding: 12 } }],
};
const deadlineShortcuts = computed(() => [
  { text: '今天', days: 0 }, { text: '明天', days: 1 }, { text: '一周后', days: 7 },
].map(({ text, days }) => ({
  text,
  value: () => {
    const day = new Date(localDate(props.timezone) + 'T12:00:00');
    day.setDate(day.getDate() + days);
    const clock = dueKind.value === 'time' ? timeValue.value.slice(11) || '23:59' : '00:00';
    const [hour, minute] = clock.split(':').map(Number);
    day.setHours(hour!, minute!, 0, 0);
    return day;
  },
})));
const taskStore=useTasks();
const workflow = computed(() => props.task ? workflowFor(props.task, taskStore.items) : null);
const scopeChoice = ref<Scope | 'auto'>('auto');
const scopeLabels: Record<Scope,string> = {work:'工作',life:'生活',study:'学习',unassigned:'未分类'};
const automaticScopeLabel = computed(() => '自动识别' + (form.value.title.trim() ? ' · ' + scopeLabels[form.value.scope] : ''));
const projects=ref<{id:string;title:string}[]>([]),dependencies=ref<{id:string;depends_on_id:string}[]>([]),dependencyId=ref(''),dependencyBusy=ref(false);
let extrasVersion = 0, editorSession = 0;
async function loadExtras(){
  const ticket = ++extrasVersion, taskId = props.task?.id;
  try {
    const [loadedProjects, loadedDependencies] = await Promise.all([
      api<{id:string;title:string}[]>('/projects'),
      taskId ? api<{id:string;depends_on_id:string}[]>('/tasks/'+taskId+'/dependencies') : Promise.resolve([]),
    ]);
    if (ticket !== extrasVersion || !props.modelValue) return;
    projects.value = loadedProjects; dependencies.value = loadedDependencies;
  } catch(e) {
    if (ticket === extrasVersion && props.modelValue) ElMessage.error((e as Error).message);
  }
}
async function newProject(){
  try{const result=await ElMessageBox.prompt('输入项目名称','新建项目');const project=await post<{id:string}>('/projects',{title:result.value,scope:form.value.scope});await loadExtras();form.value.project_id=project.id;}catch(e){if(e instanceof Error)ElMessage.error(e.message);}
}
async function dependencyChange(identifier?:string){
  if(!props.task || dependencyBusy.value)return;
  const task = props.task, ticket = editorSession;
  const isCurrent = () => props.modelValue && ticket === editorSession && props.task?.id === task.id;
  dependencyBusy.value=true;
  try {
    const result = identifier
      ? await api<{version:number}>('/tasks/'+task.id+'/dependencies/'+identifier+'?version='+task.version, {method:'DELETE'})
      : await post<{version:number}>('/tasks/'+task.id+'/dependencies', {depends_on_id:dependencyId.value, version:task.version});
    task.version = result.version;
    if (!isCurrent()) return;
    await loadExtras();
    if (!isCurrent()) return;
    await taskStore.refresh(localDate(props.timezone));
    if (!isCurrent()) return;
    task.workflow = taskStore.items.find(t => t.id === task.id)?.workflow;
    await history();
    if (isCurrent()) dependencyId.value = '';
  } catch(e) { ElMessage.error((e as Error).message); }
  finally { dependencyBusy.value=false; }
}
let originalTimeInput = "";
function blank(): TaskFields {
  return {
    title: "",
    notes: "",
    scope: props.scope,
    status: "todo",
    priority: "mid",
    parent_id: props.parent?.id || null,
    ...defaultDeadline(props.timezone),
    fail_reason: "",
    hidden: false,
    project_id:null,
    estimated_minutes:null,
  };
}
const drawerTitle = computed(() =>
  props.task ? "任务详情" : props.parent ? "添加子任务" : "新建任务",
);
let requestVersion = 0;
async function history() {
  if (!props.task) return;
  const ticket = ++requestVersion;
  historyError.value = "";
  historyBusy.value = true;
  try {
    const result = await api<TaskEvent[]>(
      "/tasks/" + props.task.id + "/events",
    );
    if (ticket === requestVersion) events.value = result;
  } catch (e) {
    if (ticket === requestVersion) historyError.value = (e as Error).message;
  } finally {
    if (ticket === requestVersion) historyBusy.value = false;
  }
}
watch(
  () => props.modelValue,
  (open) => {
    requestVersion++;
    editorSession++;
    extrasVersion++;
    dependencies.value = []; dependencyId.value = '';
    if (!open) {
      events.value = [];
      return;
    }
    form.value = props.task ? fieldsOf(props.task) : blank();
    advancedOpen.value = Boolean(props.task || props.initialRecurrence);
    repeat.value = props.initialRecurrence && !props.task && !props.parent ? 'daily' : 'none';
    recurrence.value = {frequency:'daily', interval:1, mode:'calendar', start_date:localDate(props.timezone)};
    scopeChoice.value = props.task ? props.task.scope : props.parent?.scope || (props.automaticScope ? 'auto' : props.scope);
    dateValue.value = form.value.due_date || "";
    dueKind.value = form.value.due_date
      ? "date"
      : form.value.due_at
        ? "time"
        : "none";
    if (form.value.due_at) {
      timeValue.value = dateTimeInZone(new Date(form.value.due_at), props.timezone);
    } else timeValue.value = "";
    originalTimeInput = timeValue.value;
    events.value = [];
    historyError.value = "";
    if (props.task) void history();
    void loadExtras();
  },
);
watch(
  () => [props.modelValue, form.value.title, form.value.notes, scopeChoice.value] as const,
  ([open, title, notes, choice], _previous, onCleanup) => {
    if (!open) return;
    if (choice !== 'auto') { form.value.scope = choice; return; }
    if (props.task) return;
    form.value.scope = 'unassigned';
    if (!title.trim()) return;
    let current = true;
    const timer = setTimeout(async () => {
      try {
        const result = await post<{scope:Scope}>('/tasks/classify', {title,notes});
        if (current && result.scope in scopeLabels) form.value.scope = result.scope;
      } catch { /* Saving independently classifies the latest title and notes. */ }
    }, 250);
    onCleanup(() => { current = false; clearTimeout(timer); });
  },
);
function submit() {
  if (props.busy || props.readonly || dependencyBusy.value) return;
  if (!form.value.title.trim()) { ElMessage.error('请填写任务名称'); return; }
  if (recurring.value) {
    if (!['todo', 'doing'].includes(form.value.status)) { ElMessage.error('周期任务的初始状态须为待办或进行中'); return; }
    if (!recurrence.value.start_date || !Number.isInteger(recurrence.value.interval) || recurrence.value.interval < 1 || recurrence.value.interval > 365) {
      ElMessage.error('请选择开始日期，并填写 1–365 的周期间隔'); return;
    }
    emit('save', {...form.value, title:form.value.title.trim(), due_date:null, due_at:null, due_timezone:null}, scopeChoice.value === 'auto', {...recurrence.value, frequency:repeat.value as RecurrenceSettings['frequency']});
    return;
  }
  if (form.value.status === 'failed' && !form.value.fail_reason.trim()) {
    ElMessage.error('请填写失败原因'); return;
  }
  if (dueKind.value === 'date' && !dateValue.value || dueKind.value === 'time' && !timeValue.value) {
    ElMessage.error(dueKind.value === 'date' ? '请选择截止日期。' : '请选择截止时刻。');
    return;
  }
  const result = { ...form.value };
  result.fail_reason = result.status === 'failed' ? result.fail_reason.trim() : '';
  result.due_date =
    dueKind.value === "date" && dateValue.value ? dateValue.value : null;
  try {
    result.due_at = dueKind.value === "time" && timeValue.value
      ? dateTimeToISO(timeValue.value, props.timezone) : null;
  } catch (error) { ElMessage.error((error as Error).message); return; }
  result.due_timezone = result.due_at ? props.timezone : null;
  if (
    dueKind.value === "time" &&
    props.task?.due_at &&
    timeValue.value === originalTimeInput
  ) {
    result.due_at = props.task.due_at;
    result.due_timezone = props.task.due_timezone;
  }
  emit("save", result, !props.task && scopeChoice.value === 'auto', null);
}
const kinds: Record<string, string> = {
  created: "创建任务",
  updated: "修改任务",
  status_changed: "更改状态",
  trashed: "移入垃圾站",
  restored: "恢复任务",
  imported: "由备份导入",
  imported_completion: "由旧版导入的完成记录",
};
const states = {
  todo: "待办",
  doing: "进行中",
  done: "已完成",
  failed: "失败",
  cancelled: "已取消",
};
</script>
<template>
  <el-drawer
    class="task-editor"
    :model-value="modelValue"
    :title="drawerTitle"
    size="min(480px, 100vw)"
    :close-on-click-modal="!busy"
    :close-on-press-escape="!busy"
    @update:model-value="emit('update:modelValue', $event)"
  >
    <p v-if="parent" class="parent-hint">父任务：{{ parent.title }}</p>
    <el-form
      id="task-editor-form"
      label-position="top"
      :disabled="busy || readonly"
      @submit.prevent="submit"
    >
      <el-form-item label="任务名称"
        ><el-input
          v-model="form.title"
          aria-label="任务名称"
          required
          maxlength="500"
          placeholder="具体要做什么？"
      /></el-form-item>
      <div class="form-grid">
        <el-form-item label="所属范围"
          ><el-select v-model="scopeChoice" aria-label="所属范围"
            ><el-option v-if="!task" :label="automaticScopeLabel" value="auto"/><el-option label="工作" value="work" /><el-option
              label="生活"
              value="life" /><el-option
              label="学习"
              value="study" /><el-option
              label="未分类"
              value="unassigned" /></el-select></el-form-item
        ><el-form-item label="优先级"
          ><el-select v-model="form.priority" aria-label="优先级"
            ><el-option label="高" value="high" /><el-option
              label="中"
              value="mid" /><el-option label="低" value="low" /></el-select
        ></el-form-item>
      </div>
      <el-form-item class="editor-deadline-kind" label="截止时间"
        ><template #label><span class="editor-label-action">截止时间<small v-if="!recurring && dueKind === 'time'">{{ timezone === 'Asia/Shanghai' ? '北京时间' : timezone }}</small></span></template><el-radio-group v-model="scheduleKind" aria-label="截止时间类型"
          ><el-radio-button value="none">不设截止</el-radio-button
          ><el-radio-button value="date">某一天</el-radio-button
          ><el-radio-button value="time"
            >具体时刻</el-radio-button
          ><el-radio-button v-if="!task && !parent" value="repeat">重复</el-radio-button
          ></el-radio-group
        ></el-form-item
      >
      <template v-if="!recurring">
      <el-form-item v-if="dueKind === 'date'" class="editor-deadline-value"
        ><el-date-picker
          v-model="dateValue"
          type="date"
          class="task-deadline-input"
          popper-class="task-deadline-calendar"
          placement="top-start"
          :fallback-placements="['bottom-start']"
          :popper-options="deadlinePopperOptions"
          format="YYYY-MM-DD"
          value-format="YYYY-MM-DD"
          :shortcuts="deadlineShortcuts"
          :default-value="new Date(localDate(timezone) + 'T12:00:00')"
          :clearable="false"
          aria-label="截止日期"
          placeholder="选择截止日期"
      /></el-form-item>
      <el-form-item v-if="dueKind === 'time'" class="editor-deadline-value"
        ><el-date-picker
          v-model="timeValue"
          type="datetime"
          class="task-deadline-input"
          popper-class="task-deadline-calendar"
          placement="top-start"
          :fallback-placements="['bottom-start']"
          :popper-options="deadlinePopperOptions"
          format="YYYY-MM-DD HH:mm"
          value-format="YYYY-MM-DD[T]HH:mm"
          date-format="YYYY-MM-DD"
          time-format="HH:mm"
          :default-time="defaultTime"
          :shortcuts="deadlineShortcuts"
          :clearable="false"
          :show-now="false"
          aria-label="截止时刻"
          placeholder="选择日期和时间"
        />
</el-form-item
      >
      </template>
      <el-form-item v-if="recurring" label="重复频率">
        <el-select v-model="repeat" aria-label="重复频率">
          <el-option label="每天" value="daily"/>
          <el-option label="每周" value="weekly"/>
          <el-option label="每月" value="monthly"/>
        </el-select>
      </el-form-item>
      <template v-if="recurring">
        <div class="form-grid">
          <el-form-item label="周期间隔"><el-input-number v-model="recurrence.interval" :min="1" :max="365" :precision="0" aria-label="周期间隔"/><p class="field-hint">每 {{recurrence.interval}} {{repeat === 'daily' ? '天' : repeat === 'weekly' ? '周' : '个月'}}生成一次</p></el-form-item>
          <el-form-item label="开始日期"><el-date-picker v-model="recurrence.start_date" type="date" value-format="YYYY-MM-DD" format="YYYY-MM-DD" :clearable="false" class="task-deadline-input" aria-label="周期开始日期"/></el-form-item>
        </div>
        <el-form-item label="生成方式"><el-select v-model="recurrence.mode" aria-label="周期生成方式"><el-option label="固定日历周期" value="calendar"/><el-option label="完成后间隔" value="after_completion"/></el-select></el-form-item>
        <p class="field-hint">从开始日期生成任务，每次完成记录独立保留。</p>
        <details class="help-disclosure"><summary>周期计算说明</summary><p>固定月周期会保留原日号，月份没有该日时取月末；完成后间隔从实际完成日计算。</p></details>
      </template>
      <el-form-item label="备注"
        ><el-input
          v-model="form.notes"
          type="textarea"
          :autosize="{ minRows: 2, maxRows: 5 }"
          maxlength="20000"
          aria-label="备注"
          placeholder="记录背景、步骤或需要留意的事"
      /></el-form-item>
      <details class="editor-more" :open="advancedOpen" @toggle="advancedOpen = ($event.target as HTMLDetailsElement).open">
        <summary>更多设置</summary>
        <div class="editor-more-content">
      <el-form-item label="状态"
        ><el-select v-model="form.status" aria-label="任务状态"
          ><el-option label="待办" value="todo" /><el-option
            label="进行中"
            value="doing" /><el-option label="已完成" value="done" :disabled="recurring || Boolean(task && ['failed','cancelled'].includes(task.status))" /><el-option
            label="失败"
            value="failed" :disabled="recurring" /><el-option
            label="已取消"
            value="cancelled" :disabled="recurring" /></el-select
      ></el-form-item>
      <p v-if="task && ['failed','cancelled'].includes(task.status)" class="field-hint">需要继续处理时，先保存为待办或进行中，再标记完成。重新尝试会保留原来的失败记录。</p>
      <FailureReasonInput v-if="form.status === 'failed'" v-model="form.fail_reason"/>
      <div class="form-grid editor-projects">
        <el-form-item label="项目">
          <template #label><span class="editor-label-action">项目<el-button v-if="!readonly" link @click="newProject">新建项目</el-button></span></template>
          <el-select v-model="form.project_id" clearable aria-label="项目" placeholder="不加入项目"><el-option v-for="p in projects" :key="p.id" :label="p.title" :value="p.id"/></el-select>
        </el-form-item>
        <el-form-item label="预计用时（分钟）"><el-input-number v-model="form.estimated_minutes" :min="1" :max="10080" aria-label="预计分钟"/></el-form-item>
      </div>
          <el-checkbox v-model="form.hidden">在常规清单中隐藏</el-checkbox>
        </div>
      </details>
    </el-form>
    <section v-if="task" class="history">
      <div v-if="!readonly && workflow?.blocking_dependencies.length" class="task-blocked" role="status"><strong>受阻</strong><p v-for="d in workflow.blocking_dependencies" :key="d.id">{{ dependencyMessage(d) }}<span v-if="d.fail_reason">：{{ d.fail_reason }}</span></p></div>
      <template v-if="!readonly"><h3>依赖任务</h3><div class="action-row"><el-select v-model="dependencyId" filterable aria-label="添加依赖" placeholder="需先完成哪一项？"><el-option v-for="t in taskStore.items.filter(t=>t.id!==task?.id)" :key="t.id" :label="t.title" :value="t.id"/></el-select><el-button :disabled="!dependencyId || dependencyBusy" @click="dependencyChange()">添加依赖</el-button></div><p v-for="d in dependencies" :key="d.id">{{taskStore.items.find(t=>t.id===d.depends_on_id)?.title||'垃圾站中的任务'}} <el-button text :disabled="dependencyBusy" @click="dependencyChange(d.id)">解除</el-button></p></template>
      <h3>变更记录</h3>
      <p v-if="historyBusy" class="muted">正在读取记录…</p>
      <p v-if="historyError" role="alert">
        {{ historyError }} <el-button text @click="history">重试</el-button>
      </p>
      <ol>
        <li v-for="event in [...events].reverse()" :key="event.id">
          <strong
            >{{ event.actor === "import" ? "导入历史：" : ""
            }}{{ kinds[event.kind] || event.kind }}</strong
          ><time>{{
            new Date(event.occurred_at).toLocaleString("zh-CN", {
              timeZone: timezone,
            })
          }}</time>
          <p>{{ event.after.title }} · {{ states[event.after.status] }}</p>
          <p v-if="event.after.status === 'failed'">失败原因：{{ event.after.fail_reason || '历史记录未填写' }}</p>
          <p v-if="event.before?.status === 'failed' && event.after.status !== 'failed'">此前失败原因：{{ event.before.fail_reason || '历史记录未填写' }}</p>
          <p v-if="event.before && event.before.title !== event.after.title">
            原名称：{{ event.before.title }}
          </p>
        </li>
      </ol>
    </section>
    <template #footer>
      <div class="editor-footer">
        <el-button :disabled="busy" @click="emit('update:modelValue', false)">关闭</el-button>
        <el-button v-if="!readonly" type="primary" native-type="submit" form="task-editor-form" :loading="busy" :disabled="busy || dependencyBusy">{{ task ? "保存修改" : recurring ? "创建周期任务" : "创建任务" }}</el-button>
      </div>
    </template>
  </el-drawer>
</template>

<style src="../task-editor-layout.css"></style>
