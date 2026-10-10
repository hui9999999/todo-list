<script setup lang="ts">
import {computed, nextTick, onMounted, onUnmounted, ref, watch} from 'vue';
import {VideoPlay, VideoPause, RefreshRight} from '@element-plus/icons-vue';
import {api, post} from '../api';
import {useTasks, localDate} from '../stores/tasks';
import {useAuth} from '../stores/auth';
import type {Focus} from '../advanced-types';
import {defaultDeadline} from '../task-deadline';
import DurationWheel from './DurationWheel.vue';

type Mode = 'focus' | 'short' | 'long';
type BreakState = 'idle' | 'running' | 'paused' | 'completed';
const props = defineProps<{visible?:boolean}>();
const tasks = useTasks(), auth = useAuth();
const busy = ref(true), actionPending = ref(false), error = ref(''), loaded = ref(false), now = ref(Date.now());
const sessions = ref<Focus[]>([]), selectedTask = ref(''), mode = ref<Mode>('focus');
const taskChoice = ref(''), taskQuery = ref(''), creatingTask = ref(false), taskError = ref('');
const durations = ref({focus:25, short:5, long:15});
const editingDuration = ref(false), durationDraft = ref(''), durationError = ref('');
const durationInput = ref<HTMLInputElement|null>(null);
const durationWheel=ref<InstanceType<typeof DurationWheel>|null>(null),wheelMinutes=ref(25);
const phoneMedia=window.matchMedia('(max-width:760px)'),phoneLayout=ref(phoneMedia.matches);
const syncPhoneLayout=()=>{phoneLayout.value=phoneMedia.matches;cancelDuration();};
const breakState = ref<BreakState>('idle'), breakRemaining = ref(300), breakEndsAt = ref<number|null>(null);
const finishedTask = ref('');
let fetchedAt = Date.now(), completionCheck = '';
const storageKey = 'todo-v2-pomodoro:' + auth.user?.id;
const modes: {id:Mode; label:string}[] = [{id:'focus',label:'专注'}, {id:'short',label:'短休息'}, {id:'long',label:'长休息'}];
const activeTasks = computed(() => tasks.items.filter(task => !task.deleted_at && ['todo','doing'].includes(task.status)));
const matchingTasks = computed(() => activeTasks.value.filter(task => task.title.toLocaleLowerCase().includes(taskQuery.value.trim().toLocaleLowerCase())));
const newTaskName = computed(() => taskQuery.value.trim());
const canCreateTask = computed(() => newTaskName.value.length > 0 && newTaskName.value.length <= 500 && !activeTasks.value.some(task => task.title.trim().toLocaleLowerCase() === newTaskName.value.toLocaleLowerCase()));
watch(selectedTask,value => { taskChoice.value = value; },{flush:'sync'});
const active = computed(() => sessions.value.find(row => row.state === 'running') || sessions.value.find(row => row.state === 'paused'));
const runningWork = computed(() => sessions.value.some(row => row.state === 'running'));
function elapsed(row:Focus) {
  return Math.min(row.duration_seconds, row.elapsed + (row.state === 'running' ? Math.max(0,(now.value - fetchedAt) / 1000) : 0));
}
function taskTitle(id:string) { return tasks.items.find(task => task.id === id)?.title || '任务已不可用'; }
const timezone = computed(() => auth.user?.timezone || 'Asia/Shanghai');
const today = computed(() => { void now.value; return localDate(timezone.value); });
function sessionDay(row:Focus) {
  if(!row.started_at) return '';
  const date = new Date(row.started_at);
  if(!Number.isFinite(date.getTime())) return '';
  return new Intl.DateTimeFormat('en-CA',{timeZone:timezone.value,year:'numeric',month:'2-digit',day:'2-digit'}).format(date);
}
const todaySessions = computed(() => sessions.value.filter(row => sessionDay(row) === today.value && row.state !== 'cancelled'));
const completed = computed(() => todaySessions.value.filter(row => row.state === 'completed').length);
const todayMinutes = computed(() => Math.floor(todaySessions.value.reduce((total,row) => total + elapsed(row),0) / 60));
const round = computed(() => completed.value % 4 + 1);
const history = computed(() => sessions.value.filter(row => row.id !== active.value?.id));
const totalSeconds = computed(() => mode.value === 'focus' && active.value ? active.value.duration_seconds : durations.value[mode.value] * 60);
const remaining = computed(() => {
  if(mode.value === 'focus') return active.value ? Math.max(0,Math.ceil(active.value.duration_seconds - elapsed(active.value))) : totalSeconds.value;
  if(breakState.value === 'running' && breakEndsAt.value !== null) return Math.max(0,Math.ceil((breakEndsAt.value - now.value) / 1000));
  return breakState.value === 'idle' ? totalSeconds.value : breakRemaining.value;
});
const displayClock = computed(() => `${Math.floor(remaining.value/60).toString().padStart(2,'0')}:${(remaining.value%60).toString().padStart(2,'0')}`);
const progress = computed(() => Math.min(1,Math.max(0,1 - remaining.value / totalSeconds.value)));
const stateLabel = computed(() => mode.value === 'focus'
  ? active.value?.state === 'running' ? '专注中' : active.value?.state === 'paused' ? '已暂停' : '准备开始'
  : breakState.value === 'running' ? '休息中' : breakState.value === 'paused' ? '已暂停' : breakState.value === 'completed' ? '休息结束' : '准备休息');
const primaryLabel = computed(() => mode.value === 'focus'
  ? active.value?.state === 'running' ? '暂停' : active.value?.state === 'paused' ? '继续' : '开始专注'
  : breakState.value === 'running' ? '暂停休息' : breakState.value === 'paused' ? '继续休息' : '开始休息');
const primaryDisabled = computed(() => busy.value || creatingTask.value || !loaded.value || (mode.value === 'focus' && !active.value && !activeTasks.value.some(task => task.id === selectedTask.value)));
const durationEditable = computed(() => loaded.value && !active.value && (mode.value === 'focus' || !['running','paused'].includes(breakState.value)));
const durationLimit = computed(() => mode.value === 'focus' ? 180 : 60);
const durationLabel = computed(() => modes.find(option => option.id === mode.value)!.label + '分钟');

function filterTasks(query:string) { taskQuery.value = query; if(query.trim()) taskError.value = ''; }
function confirmNewTask(event:KeyboardEvent) {
  // Commit the typed name even before the dropdown's new option has mounted.
  if(event.isComposing || event.keyCode === 229) { event.stopPropagation(); return; }
  if(busy.value || creatingTask.value || active.value || !loaded.value || matchingTasks.value.length || !canCreateTask.value) return;
  const value = 'create:' + newTaskName.value;
  event.preventDefault(); event.stopPropagation(); taskChoice.value = value;
  void chooseOrCreateTask(value);
  if(event.target instanceof HTMLInputElement) event.target.blur();
}
async function chooseOrCreateTask(value:string) {
  if(busy.value || creatingTask.value || active.value || !loaded.value) return;
  taskError.value = '';
  const existing = activeTasks.value.find(task => task.id === value);
  if(existing) { selectedTask.value = existing.id; return; }
  if(!value.startsWith('create:')) { taskChoice.value = selectedTask.value; return; }
  const title = value.slice(7).trim();
  if(!title || title.length > 500) { taskChoice.value = selectedTask.value; taskError.value = '请输入 1–500 字的任务名称'; return; }
  const same = activeTasks.value.find(task => task.title.trim().toLocaleLowerCase() === title.toLocaleLowerCase());
  if(same) { selectedTask.value = same.id; taskChoice.value = same.id; return; }
  creatingTask.value = true;
  try {
    const task = await tasks.create({title,notes:'',scope:'unassigned',status:'todo',priority:'mid',parent_id:null,project_id:null,estimated_minutes:null,...defaultDeadline(timezone.value),fail_reason:'',hidden:false}, true);
    tasks.items = [...tasks.items.filter(row => row.id !== task.id),task];
    selectedTask.value = task.id; taskChoice.value = task.id; taskQuery.value = '';
  } catch(e) { taskChoice.value = selectedTask.value; taskError.value = (e as Error).message; }
  finally { creatingTask.value = false; }
}

async function editDuration() {
  if(busy.value || !durationEditable.value) return;
  durationDraft.value = String(durations.value[mode.value]); durationError.value = ''; editingDuration.value = true;
  wheelMinutes.value=durations.value[mode.value];
  if(phoneLayout.value)return;
  await nextTick(); durationInput.value?.focus(); durationInput.value?.select();
}
function cancelDuration() { editingDuration.value = false; durationError.value = ''; }
function commitWheelDuration(){
  if(!durationEditable.value){cancelDuration();return;}
  durations.value[mode.value]=durationWheel.value?.settle() ?? wheelMinutes.value;
  if(mode.value!=='focus')resetBreak();
  cancelDuration();
}
function commitDuration() {
  if(!editingDuration.value) return true;
  const minutes = Number(durationDraft.value);
  if(!Number.isInteger(minutes) || minutes < 1 || minutes > durationLimit.value) {
    durationError.value = `请输入 1–${durationLimit.value} 的整数分钟`; return false;
  }
  durations.value[mode.value] = minutes;
  if(mode.value !== 'focus') resetBreak();
  cancelDuration(); return true;
}
watch(mode,cancelDuration);
watch(durationEditable,allowed => { if(!allowed) cancelDuration(); });

function persist() {
  try { localStorage.setItem(storageKey,JSON.stringify({mode:mode.value,durations:durations.value,state:breakState.value,remaining:breakRemaining.value,endsAt:breakEndsAt.value})); }
  catch { /* Timing remains usable when storage is unavailable. */ }
}
function restore() {
  try {
    const saved = JSON.parse(localStorage.getItem(storageKey) || 'null');
    if(!saved) return;
    for(const key of ['focus','short','long'] as Mode[]) {
      const value = saved.durations?.[key];
      if(Number.isInteger(value) && value >= 1 && value <= (key === 'focus' ? 180 : 60)) durations.value[key] = value;
    }
    if(['focus','short','long'].includes(saved.mode)) mode.value = saved.mode;
    if(['idle','running','paused','completed'].includes(saved.state) && Number.isFinite(saved.remaining) && saved.remaining >= 0 && saved.remaining <= 3600) {
      breakState.value = saved.state; breakRemaining.value = saved.remaining;
      breakEndsAt.value = Number.isFinite(saved.endsAt) ? saved.endsAt : null;
      if(breakState.value === 'running' && breakEndsAt.value === null) resetBreak();
    }
  } catch { /* Ignore damaged or unavailable local preferences. */ }
}
async function act(fn:()=>Promise<void>, showProgress = true) {
  busy.value = true; actionPending.value = showProgress; error.value = '';
  try { await fn(); } catch(e) { error.value = (e as Error).message; }
  finally { busy.value = false; actionPending.value = false; }
}
async function load() {
  const previous = active.value;
  const rows = await api<Focus[]>('/focus-sessions');
  fetchedAt = Date.now(); now.value = fetchedAt; sessions.value = rows; loaded.value = true;
  if(active.value) { mode.value = 'focus'; selectedTask.value = active.value.task_id; breakState.value = 'idle'; breakEndsAt.value = null; }
  else if(previous && rows.some(row => row.id === previous.id && row.state === 'completed')) {
    finishedTask.value = taskTitle(previous.task_id);
    mode.value = completed.value > 0 && completed.value % 4 === 0 ? 'long' : 'short';
    resetBreak();
  }
  persist();
}
async function refresh() { await act(async() => { await tasks.refresh(today.value); await load(); },false); }
async function control(row:Focus, action:string) { await post('/focus-sessions/' + row.id,{version:row.version,action}); await load(); }
function resetBreak() {
  breakState.value = 'idle'; breakRemaining.value = durations.value[mode.value] * 60; breakEndsAt.value = null; persist();
}
function switchMode(next:Mode) {
  if(busy.value || active.value || breakState.value === 'running' || breakState.value === 'paused') return;
  mode.value = next; resetBreak();
}
async function primary() {
  if(primaryDisabled.value) return;
  if(!commitDuration()) { durationInput.value?.focus(); return; }
  if(mode.value === 'focus') {
    await act(async() => {
      if(active.value) await control(active.value,active.value.state === 'running' ? 'pause' : 'resume');
      else { await post('/focus-sessions',{task_id:selectedTask.value,minutes:durations.value.focus}); finishedTask.value = ''; await load(); }
    });
  } else {
    now.value = Date.now();
    if(breakState.value === 'running') { breakRemaining.value = remaining.value; breakEndsAt.value = null; breakState.value = 'paused'; }
    else { const seconds = breakState.value === 'paused' ? breakRemaining.value : totalSeconds.value; breakEndsAt.value = now.value + seconds * 1000; breakState.value = 'running'; }
    persist();
  }
}
function endBreak() { mode.value = 'focus'; finishedTask.value = ''; resetBreak(); }
watch(durations,() => {
  for(const key of ['focus','short','long'] as Mode[]) {
    const value = durations.value[key];
    durations.value[key] = Number.isFinite(value) ? Math.min(key === 'focus' ? 180 : 60,Math.max(1,Math.round(value))) : {focus:25,short:5,long:15}[key];
  }
  if(breakState.value === 'idle') breakRemaining.value = totalSeconds.value;
  persist();
},{deep:true});
restore();
const ticker = window.setInterval(() => {
  now.value = Date.now();
  if(mode.value !== 'focus' && breakState.value === 'running' && remaining.value === 0) { breakState.value = 'completed'; breakRemaining.value = 0; breakEndsAt.value = null; persist(); }
  const row = active.value;
  if(row?.state === 'running' && elapsed(row) >= row.duration_seconds && !busy.value && completionCheck !== row.id + ':' + row.version) {
    completionCheck = row.id + ':' + row.version; void act(load,false);
  }
},1000);
onMounted(()=>{phoneMedia.addEventListener('change',syncPhoneLayout);void refresh();});
watch(() => props.visible, (visible, previous) => {
  if(visible && previous === false && loaded.value && !busy.value) void refresh();
});
onUnmounted(() => {clearInterval(ticker);phoneMedia.removeEventListener('change',syncPhoneLayout);});
</script>
<template>
  <div class="feature-page pomodoro-page" :class="{'pomodoro-break':mode !== 'focus'}">
    <el-alert v-if="error" :title="error" type="error" :closable="false"><el-button text :disabled="busy" @click="refresh">重试</el-button></el-alert>
    <div class="pomodoro-layout">
      <section class="pomodoro-timer" aria-label="番茄钟">
        <div class="pomodoro-modes" role="group" aria-label="番茄钟时段">
          <button v-for="option in modes" :key="option.id" type="button" :aria-pressed="mode === option.id" :disabled="busy || !!active || breakState === 'running' || breakState === 'paused'" @click="switchMode(option.id)">{{option.label}}</button>
        </div>
        <div class="pomodoro-dial" role="timer" :aria-label="stateLabel + '，剩余 ' + displayClock">
          <svg viewBox="0 0 240 240" aria-hidden="true"><circle class="pomodoro-track" cx="120" cy="120" r="108"/><circle class="pomodoro-progress" cx="120" cy="120" r="108" stroke-dasharray="678.584" :stroke-dashoffset="678.584 * progress"/></svg>
          <div class="pomodoro-dial-content">
            <span class="pomodoro-round">{{mode === 'focus' ? '第 ' + round + ' 轮专注' : mode === 'short' ? '短休息' : '长休息'}}</span>
            <form v-if="editingDuration && !phoneLayout" class="focus-clock pomodoro-clock-editor" novalidate @submit.prevent="commitDuration">
              <input ref="durationInput" v-model="durationDraft" type="number" inputmode="numeric" :min="1" :max="durationLimit" step="1" :aria-label="durationLabel" :aria-invalid="!!durationError" :aria-describedby="durationError ? 'pomodoro-duration-error' : undefined" @keydown.esc.prevent="cancelDuration" @blur="commitDuration"><span aria-hidden="true">:00</span>
            </form>
            <button v-else-if="durationEditable" type="button" class="focus-clock pomodoro-clock-button" :aria-label="'修改' + durationLabel" :title="phoneLayout ? undefined : '点击修改时长'" :disabled="busy" @click="editDuration">{{displayClock}}</button>
            <p v-else class="focus-clock">{{displayClock}}</p>
            <span v-if="durationError" id="pomodoro-duration-error" class="pomodoro-state pomodoro-duration-error" role="alert">{{durationError}}</span>
          </div>
        </div>
        <div class="pomodoro-controls">
          <el-button class="pomodoro-primary" type="primary" :icon="(mode === 'focus' && active?.state === 'running') || (mode !== 'focus' && breakState === 'running') ? VideoPause : VideoPlay" :disabled="primaryDisabled" :loading="actionPending" @click="primary">{{primaryLabel}}</el-button>
          <el-button v-if="mode === 'focus' && active" :disabled="busy" @click="act(() => control(active!,'finish'))">结束并记录</el-button>
          <el-button v-if="mode !== 'focus' && breakState !== 'idle'" text :icon="RefreshRight" :disabled="busy" @click="endBreak">{{breakState === 'completed' ? '返回专注' : '结束休息'}}</el-button>
          <el-button v-if="mode === 'focus' && active" text :disabled="busy" @click="act(() => control(active!,'cancel'))">取消</el-button>
        </div>
        <p v-if="mode !== 'focus' && breakState === 'completed'" class="pomodoro-notice" role="status">休息结束，可以开始下一轮专注。</p>
        <p v-else-if="mode !== 'focus' && finishedTask" class="pomodoro-notice" role="status">已记录「{{finishedTask}}」，休息一下再继续。</p>
        <div class="pomodoro-rounds" aria-label="今日已完成轮次"><span v-for="number in 4" :key="number" :class="{filled:number <= (completed % 4 || (completed ? 4 : 0))}"></span><small>每 4 轮后长休息</small></div>
      </section>
      <aside class="pomodoro-sidebar" aria-label="专注安排">
        <section class="pomodoro-task">
          <h2>本轮任务</h2>
          <p v-if="active" class="pomodoro-task-title">{{taskTitle(active.task_id)}}</p>
          <el-select v-else v-model="taskChoice" filterable default-first-option fit-input-width :filter-method="filterTasks" placeholder="选择任务，或输入名称新建" aria-label="专注任务" :disabled="busy || creatingTask || !loaded" :loading="creatingTask" @change="chooseOrCreateTask" @keydown.enter.capture="confirmNewTask" @keydown.esc.capture="taskQuery = ''" @visible-change="!$event && (taskQuery = '')">
            <el-option v-for="task in matchingTasks" :key="task.id" :value="task.id" :label="task.title"/>
            <el-option v-if="canCreateTask" :value="'create:' + newTaskName" :label="newTaskName"><span class="pomodoro-create-option">创建「{{newTaskName}}」<small>回车创建并选中</small></span></el-option>
            <template #empty><p class="pomodoro-task-empty">{{newTaskName.length > 500 ? '任务名称不能超过 500 字' : '输入名称即可创建任务'}}</p></template>
          </el-select>
          <p v-if="creatingTask" class="field-hint" role="status">正在创建任务…</p>
          <p v-if="taskError" class="pomodoro-task-error" role="alert">{{taskError}}</p>
        </section>
        <section class="pomodoro-today" aria-label="今日专注"><h2>今日专注</h2><div><p><strong>{{completed}}</strong><span>完成轮次</span></p><p><strong>{{todayMinutes}}<small>分钟</small></strong><span>专注时长</span></p></div></section>
      </aside>
    </div>
    <el-drawer :model-value="editingDuration && phoneLayout" direction="btt" size="auto" :title="'设置'+modes.find(option=>option.id===mode)!.label+'时长'" class="pomodoro-duration-sheet" destroy-on-close @close="cancelDuration">
      <DurationWheel v-if="editingDuration && phoneLayout" ref="durationWheel" v-model="wheelMinutes" :max="durationLimit" :label="durationLabel"/>
      <template #footer><el-button @click="cancelDuration">取消</el-button><el-button type="primary" @click="commitWheelDuration">确认时长</el-button></template>
    </el-drawer>
    <details class="pomodoro-history"><summary>专注记录 <span>{{sessions.length}}</span></summary><div class="pomodoro-history-tools"><el-button text :disabled="busy" @click="refresh">刷新记录</el-button></div><article v-for="row in history" :key="row.id" class="pomodoro-history-row"><div><strong>{{taskTitle(row.task_id)}}</strong><p><span>{{row.state === 'paused' ? '已暂停' : row.state === 'completed' ? '已结束' : '已取消'}}</span><span v-if="row.started_at">{{new Date(row.started_at).toLocaleString('zh-CN',{timeZone:timezone})}}</span></p></div><span>{{Math.floor(elapsed(row)/60)}} 分钟</span><div v-if="row.state === 'paused'" class="pomodoro-history-actions"><el-button size="small" :disabled="busy || runningWork" @click="act(() => control(row,'resume'))">继续此轮</el-button><el-button size="small" :disabled="busy" @click="act(() => control(row,'finish'))">记录结束</el-button><el-button size="small" text :disabled="busy" @click="act(() => control(row,'cancel'))">取消此轮</el-button></div></article><p v-if="!history.length" class="field-hint">还没有其他专注记录。</p></details>
  </div>
</template>
