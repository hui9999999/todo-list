<script setup lang="ts">
import {saveFile} from '../save-file';
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import {
  Sunny,
  List,
  Delete,
  FolderOpened,
  Setting,
  Plus,
  Search,
  Refresh,
  Download,
  Upload,
  ArrowRight,
  Fold, Expand,
  ChatDotRound, Reading, Calendar, DataAnalysis, Timer,
  CoffeeCup, ForkSpoon,
} from "@element-plus/icons-vue";
import { ElMessage, ElMessageBox } from "element-plus";
import { api, post, ApiError } from "../api";
import { useAuth } from "../stores/auth";
import { useTasks, fieldsOf, localDate } from "../stores/tasks";
import { defaultDeadline } from '../task-deadline';
import {checklistPeriods, checklistPeriod, checklistRange, taskDeadlineDate, inChecklist} from '../task-period';
import type { Task, TaskFields, Scope, ImportPreview, Status } from "../types";
import { workflowFor } from '../task-workflow';
import TaskStatusDialog from '../components/TaskStatusDialog.vue';
import TaskRow from "../components/TaskRow.vue";
import TaskEditor from "../components/TaskEditor.vue";
import AIAssistant from '../components/AIAssistant.vue';
import SettingsPanel from '../components/SettingsPanel.vue';
import DueNotifications from '../components/DueNotifications.vue';
import RecommendationPanel from '../components/RecommendationPanel.vue';
import PlanningPanel from '../components/PlanningPanel.vue';
import FocusPanel from '../components/FocusPanel.vue';
import StatisticsPanel from '../components/StatisticsPanel.vue';
import ExportPanel from '../components/ExportPanel.vue';
import type {Settings, RecurrenceSettings} from '../advanced-types';
import {applyTheme} from '../themes';
import ThemePicker from '../components/ThemePicker.vue';
import DesktopPetPanel from '../components/DesktopPetPanel.vue';
import AdminPanel from '../components/AdminPanel.vue';
import FoodPanel from '../components/FoodPanel.vue';
const auth = useAuth(),
  tasks = useTasks(),
  route = useRoute(),
  router = useRouter();
const view = computed(() => String(route.params.view || "today"));
const isChecklist=computed(()=>['today','tasks'].includes(view.value));
const period=computed(()=>checklistPeriod(route.query.period));
const isDaily=computed(()=>isChecklist.value && period.value==='today');
const periodRange=computed(()=>checklistRange(period.value,day.value));
const timezone=computed(()=>auth.user?.timezone || 'Asia/Shanghai');
const sidebarStorageKey = 'todo-v2-sidebar-hidden';
const sidebarHidden = ref(readSidebarHidden());
const sidebarToggle = ref<HTMLButtonElement | null>(null);
function readSidebarHidden() {
  try { return localStorage.getItem(sidebarStorageKey) === '1'; }
  catch { return false; }
}
async function toggleSidebar() {
  sidebarHidden.value = !sidebarHidden.value;
  try { localStorage.setItem(sidebarStorageKey, sidebarHidden.value ? '1' : '0'); }
  catch { /* The toggle still works when browser storage is unavailable. */ }
  await nextTick();
  sidebarToggle.value?.focus();
}
const aiChat = computed(() => view.value === 'ai');
const desktopChat=computed(()=>Boolean(window.xiaoqiDesktop) && view.value==='ai');
const desktopShell=Boolean(window.xiaoqiDesktop);
const desktopCompact=computed(()=>desktopShell && (view.value==='ai' || isChecklist.value || view.value==='focus'));
const chatVisited=ref(view.value==='ai');
const focusVisited=ref(view.value==='focus');
watch(view,value=>{if(value==='ai')chatVisited.value=true;if(value==='focus')focusVisited.value=true;});
const dataTab = computed(() => ['backup', 'trash'].includes(String(route.query.tab)) ? String(route.query.tab) : 'export');
const isTrash = computed(() => view.value === 'data' && dataTab.value === 'trash');
const clockTick=ref(Date.now());
const day = computed(() => {void clockTick.value; return localDate(auth.user?.timezone || "Asia/Shanghai");});
const userSettings=ref<Settings|null>(null), weather=ref<{city:string;current:{temperature_2m:number}}|null>(null);
const weatherBusy=ref(true), weatherError=ref('');
let weatherRequest=0;
const dueReminders=ref<Task[]>([]), notificationPreview=ref<Task|null>(null);
const notifiedKeys=new Set<string>();
let reminderHideTimer:number|undefined;
const timer=window.setInterval(()=>{clockTick.value=Date.now(); void notifyDue();},60000);
async function loadSettings(){
  try {await applySettings(await api<Settings>('/settings'));} catch {weatherBusy.value=false;weatherError.value='天气设置暂时无法读取';}
}
async function applySettings(settings:Settings){
  if(userSettings.value && settings.version < userSettings.value.version)return;
  userSettings.value={...settings};
  applyTheme(settings.theme);
  if(!settings.notifications_enabled){dueReminders.value=[];notificationPreview.value=null;}
  await loadWeather();
}
async function loadWeather(){
  const settings=userSettings.value, request=++weatherRequest;
  weather.value=null;weatherError.value='';weatherBusy.value=Boolean(settings?.weather_enabled);
  if(settings?.weather_enabled){try{
    const result=await api<{city:string;current:{temperature_2m:number}}|{enabled:false}>('/weather');
    if(request!==weatherRequest)return;
    if('current' in result && Number.isFinite(result.current?.temperature_2m))weather.value=result;
    else weatherError.value='天气信息暂时不可用，请重试';
  }catch(e){if(request===weatherRequest)weatherError.value=(e as Error).message;}
  finally{if(request===weatherRequest)weatherBusy.value=false;}}
}
async function retryWeather(){if(!userSettings.value)await loadSettings();else await loadWeather();}
function isDue(task:Task){return ['todo','doing'].includes(task.status) && !task.deleted_at && Boolean((task.due_date && task.due_date<=day.value) || (task.due_at && new Date(task.due_at).getTime()<=Date.now()));}
// Reminder keys are day-scoped; drop other days so storage stays bounded by today's tasks.
function pruneDueReminderKeys(){
  const prefix=`todo-due:${auth.user?.id}:`, keep=`:${day.value}`;
  for(const key of notifiedKeys)if(!key.endsWith(keep))notifiedKeys.delete(key);
  try{
    const stale:string[]=[];
    for(let i=0;i<localStorage.length;i++){const key=localStorage.key(i);if(key&&key.startsWith(prefix)&&!key.endsWith(keep))stale.push(key);}
    for(const key of stale)localStorage.removeItem(key);
  }catch{/* Storage may be unavailable. */}
}
async function notifyDue(){
  if(!userSettings.value?.notifications_enabled)return;
  pruneDueReminderKeys();
  dueReminders.value=dueReminders.value.map(row=>tasks.items.find(task=>task.id===row.id)).filter((task):task is Task=>Boolean(task && isDue(task)));
  const fresh:Task[]=[];
  for(const task of tasks.items){
    if(!isDue(task))continue;
    const key=`todo-due:${auth.user?.id}:${task.id}:${task.version}:${day.value}`;
    let seen=notifiedKeys.has(key);
    try{seen ||= Boolean(localStorage.getItem(key));}catch{/* Session deduplication still works without storage. */}
    if(seen)continue;
    fresh.push(task);notifiedKeys.add(key);
    try{localStorage.setItem(key,'1');}catch{/* Storage may be unavailable. */}
  }
  if(!fresh.length)return;
  notificationPreview.value=null;
  dueReminders.value=[...new Map([...fresh,...dueReminders.value].map(task=>[task.id,task])).values()];
  window.clearTimeout(reminderHideTimer);
  reminderHideTimer=window.setTimeout(()=>{dueReminders.value=[];},20000);
  if('Notification' in window && Notification.permission==='granted'){
    try{
      const notification=new Notification(fresh.length===1?'待办到期提醒':`${fresh.length} 项待办已到期`,{body:fresh.slice(0,3).map(task=>task.title).join(' · '),tag:`todo-due:${auth.user?.id}:${day.value}`,icon:'/notification-icon.svg'});
      notification.onclick=()=>{window.focus();open(fresh[0]!);notification.close?.();};
    }catch{/* Application reminders remain available when system notifications fail. */}
  }
}
function previewDueNotification(){notificationPreview.value={id:'notification-preview',title:'整理今日计划',notes:'',scope:'work',status:'todo',priority:'high',parent_id:null,due_date:day.value,due_at:null,due_timezone:null,fail_reason:'',hidden:false,version:1,completed_at:null,created_at:new Date().toISOString(),updated_at:new Date().toISOString(),deleted_at:null,legacy_period:null};}
function dismissDue(id:string){if(notificationPreview.value){notificationPreview.value=null;return;}dueReminders.value=dueReminders.value.filter(task=>task.id!==id);}
function clearDue(){notificationPreview.value=null;dueReminders.value=[];window.clearTimeout(reminderHideTimer);}
function openDue(task:Task){if(notificationPreview.value){notificationPreview.value=null;return;}open(task);dismissDue(task.id);}
const scope = ref("all"),
  status = ref("active"),
  search = ref(""),
  quickTitle = ref(""),
  busy = ref(false),
  error = ref("");
const mobileMedia=window.matchMedia('(max-width:760px)');
const mobileLayout=ref(mobileMedia.matches);
const syncMobileLayout=()=>{mobileLayout.value=mobileMedia.matches;};
watch([mobileLayout,isChecklist],()=>{if(mobileLayout.value && isChecklist.value){scope.value='all';search.value='';}}, {immediate:true});
const showHidden = ref(false),
  editor = ref(false),
  selected = ref<Task | null>(null),
  parent = ref<Task | null>(null);
const initialRecurrence = ref(false);
const recurrenceRevision = ref(0);
const statusDialogOpen = ref(false), statusPromptBusy = ref(false);
const pendingStatus = ref<{task: Task; fields: TaskFields; automaticScope: boolean; mode: 'failure' | 'resolution'} | null>(null);
const importScope = ref<Scope>("unassigned"),
  preview = ref<ImportPreview | null>(null),
  inputFile = ref<HTMLInputElement | null>(null);
const fileName = ref("");
const nav = computed(() => [
  { id: "tasks", title: "清单", icon: List },
  { id: 'calendar', title: '日历', icon: Calendar },
  { id: 'focus', title: '专注', icon: Timer },
  { id: 'ai', title: 'AI 助手', icon: ChatDotRound },
  { id: 'stats', title: '统计', icon: DataAnalysis },
  { id: 'news', title: '资讯', icon: Reading },
  { id: 'pet', title: '小狒桌宠', icon: CoffeeCup },
  { id: "data", title: "数据管理", icon: FolderOpened },
  { id: 'food', title: '吃点什么', icon: ForkSpoon },
  ...(auth.user?.is_admin ? [{id:'admin',title:'管理后台',icon:Setting}] : []),
]);
const title = computed(
  () => isChecklist.value ? checklistPeriods.find(item=>item.id===period.value)!.title : view.value === 'account' ? '个人账户' : view.value === 'recurrences' ? '周期任务' : nav.value.find((n) => n.id === view.value)?.title || "今日清单",
);
const planned = computed(() => new Set(tasks.plans.map((p) => p.task_id)));
const belongsToPeriod=(task:Task)=>inChecklist(task,periodRange.value,timezone.value,planned.value);
// Progress tracks pending and completed work; hidden tasks follow the visibility toggle.
const periodTasks=computed(()=>tasks.items.filter(task=>!task.deleted_at && (!task.hidden || showHidden.value) && ['todo','doing','done'].includes(task.status) && belongsToPeriod(task)));
const isScheduledGroup=(group:{task:Task;depth:number}[])=>group.some(row=>belongsToPeriod(row.task));
const taskGroups = computed(() => {
  const groups: {task: Task; depth: number}[][] = [];
  for (const row of visibleRows.value) {
    if (row.depth === 0 || !groups.length) groups.push([]);
    groups[groups.length - 1]!.push(row);
  }
  return isChecklist.value ? [...groups.filter(isScheduledGroup),...groups.filter(group=>!isScheduledGroup(group))] : groups;
});
const scheduledCount=computed(()=>taskGroups.value.filter(isScheduledGroup).flat().length);
const unscheduledCount=computed(()=>taskGroups.value.filter(group=>!isScheduledGroup(group)).flat().length);
const visibleRows = computed(() => {
  const source = isTrash.value ? tasks.trash : tasks.items;
  const included = new Set<string>();
  const byId = new Map(source.map((t) => [t.id, t]));
  for (const task of source) {
    if (scope.value !== "all" && task.scope !== scope.value) continue;
    if (!isTrash.value) {
      if (task.hidden && !showHidden.value) continue;
      if (isChecklist.value && !belongsToPeriod(task) && taskDeadlineDate(task,timezone.value)) continue;
      if (status.value === "active" && !["todo", "doing"].includes(task.status))
        continue;
      if (
        status.value !== "active" &&
        status.value !== "all" &&
        task.status !== status.value
      )
        continue;
    }
    if (
      search.value &&
      !`${task.title} ${task.notes}`
        .toLowerCase()
        .includes(search.value.toLowerCase())
    )
      continue;
    included.add(task.id);
    let ancestor = task.parent_id ? byId.get(task.parent_id) : null;
    const seen = new Set<string>();
    while (ancestor && !seen.has(ancestor.id)) {
      included.add(ancestor.id);
      seen.add(ancestor.id);
      ancestor = ancestor.parent_id ? byId.get(ancestor.parent_id) : null;
    }
  }
  const result: { task: Task; depth: number }[] = [];
  const seen = new Set<string>();
  const priority = { high: 0, mid: 1, low: 2 };
  const children = new Map<string | null, Task[]>();
  for (const task of source) {
    const key =
      task.parent_id && byId.has(task.parent_id) ? task.parent_id : null;
    const group = children.get(key) || [];
    group.push(task);
    children.set(key, group);
  }
  for (const group of children.values())
    group.sort(
      (a, b) =>
        priority[a.priority] - priority[b.priority] ||
        a.created_at.localeCompare(b.created_at),
    );
  function visit(id: string | null, depth: number) {
    for (const task of children.get(id) || []) {
      if (seen.has(task.id)) continue;
      seen.add(task.id);
      if (included.has(task.id)) result.push({ task, depth });
      visit(task.id, depth + 1);
    }
  }
  visit(null, 0);
  return result;
});
const activeCount = computed(
  () => tasks.items.filter((t) => ["todo", "doing"].includes(t.status)).length,
);
async function refresh() {
  error.value = "";
  try {
    await tasks.refresh(day.value);
  } catch (e) {
    error.value = (e as Error).message;
    if (e instanceof ApiError && e.status === 401) {
      tasks.clear();
      auth.user = null;
      await router.replace("/auth");
    }
  }
}
async function run(action: () => Promise<unknown>, message?: string) {
  if (busy.value) return;
  busy.value = true;
  try {
    await action();
    await refresh();
    if (message) ElMessage.success(message);
  } catch (e) {
    ElMessage.error((e as Error).message);
    if (e instanceof ApiError && [401, 409].includes(e.status)) {
      editor.value = false;
      statusDialogOpen.value = false;
      await refresh();
    }
  } finally {
    busy.value = false;
  }
}
function open(task: Task | null = null, ancestor: Task | null = null) {
  initialRecurrence.value = false;
  selected.value = task;
  parent.value = ancestor;
  editor.value = true;
}
function openRecurrence() {
  open();
  initialRecurrence.value = true;
}
async function persistSave(task: Task | null, fields: TaskFields, automaticScope = false, review?: Record<string, number>) {
  await run(async () => {
    if (task) await tasks.update(task, fields, review);
    else await tasks.create(fields, automaticScope);
    editor.value = false;
    statusDialogOpen.value = false;
  }, "任务已保存");
}
function checkOutcome(task: Task, fields: TaskFields) {
  const workflow = workflowFor(task, tasks.items);
  if (['done','failed','cancelled'].includes(fields.status) && workflow.active_children.length) {
    ElMessage.error('请先处理所有待办或进行中的子任务，再选择父任务结果');
    return false;
  }
  if (fields.status === 'done' && task.status !== 'done' && workflow.failed_children.length) {
    pendingStatus.value = {task, fields, automaticScope: false, mode: 'resolution'};
    statusDialogOpen.value = true;
    return false;
  }
  return true;
}
async function save(fields: TaskFields, automaticScope = false, recurrence: RecurrenceSettings | null = null) {
  if (busy.value) return;
  if (recurrence && !selected.value && !parent.value) {
    await run(async () => {
      await tasks.createRecurrence(fields, recurrence, automaticScope);
      recurrenceRevision.value++;
      editor.value = false;
    }, '周期任务已创建');
    return;
  }
  if (selected.value && !checkOutcome(selected.value, fields)) return;
  await persistSave(selected.value, fields, automaticScope);
}
async function confirmStatus(fields: TaskFields, review?: Record<string, number>) {
  const pending = pendingStatus.value;
  if (!pending || busy.value) return;
  await persistSave(pending.task, fields, pending.automaticScope, review);
}
async function quickAdd() {
  if (!quickTitle.value.trim()) return;
  const fields: TaskFields = {
    title: quickTitle.value.trim(),
    notes: "",
    scope: (scope.value === "all" ? "unassigned" : scope.value) as Scope,
    priority: "mid",
    status: "todo",
    parent_id: null,
    ...defaultDeadline(auth.user?.timezone || 'Asia/Shanghai'),
    fail_reason: "",
    hidden: false,
  };
  await run(async () => {
    const task = await tasks.create(fields, scope.value === 'all');
    quickTitle.value = "";
    if (isDaily.value) await tasks.plan(task, day.value);
  }, "已记录");
}
async function toggle(task: Task) {
  if (!['todo','doing','done'].includes(task.status)) return;
  await changeStatus(task, task.status === 'done' ? 'todo' : 'done');
}
async function changeStatus(task: Task, next: Status) {
  if (busy.value || statusPromptBusy.value || statusDialogOpen.value) return;
  const fields = {...fieldsOf(task), status: next, fail_reason: ''};
  if (!checkOutcome(task, fields)) return;
  if (next === 'failed') {
    pendingStatus.value = {task, fields, automaticScope: false, mode: 'failure'};
    statusDialogOpen.value = true;
    return;
  }
  if (next === 'cancelled') {
    statusPromptBusy.value = true;
    try {
      await ElMessageBox.confirm(`确定不再执行“${task.title}”吗？取消会保留任务记录，之后可以重新打开。`, '取消任务', {confirmButtonText: '确认取消任务', cancelButtonText: '返回'});
    } catch { return; }
    finally { statusPromptBusy.value = false; }
  }
  await run(() => tasks.update(task, fields), next === 'todo' && task.status === 'failed' ? '已重新加入待办，失败记录已保留' : '状态已更新');
}
async function togglePlan(task: Task) {
  const item = tasks.plans.find((p) => p.task_id === task.id);
  await run(
    () => (item ? tasks.unplan(item) : tasks.plan(task, day.value)),
    item ? "已移出今日安排" : "已加入今日安排",
  );
}
async function trash(task: Task) {
  try {
    await ElMessageBox.confirm(
      `“${task.title}”及其子任务会移入垃圾站，可在垃圾站恢复。`,
      "移入垃圾站",
      {
        confirmButtonText: "移入垃圾站",
        cancelButtonText: "取消",
        type: "warning",
      },
    );
    await run(() => tasks.moveToTrash(task), "已移入垃圾站");
  } catch {
    /* Dialog dismissal leaves tasks unchanged. */
  }
}
async function purge(task:Task){
  try{await ElMessageBox.confirm(`永久删除“${task.title}”及其子任务、历史和索引？此操作无法恢复。`,'永久删除',{type:'warning',confirmButtonText:'永久删除'});}catch{return;}
  await run(()=>post('/tasks/'+task.id+'/purge',{version:task.version}),'任务已永久删除');
}
async function exportData(compat: boolean) {
  if (busy.value) return;
  busy.value = true;
  try {
    const data = await api("/exports?compat=" + compat);
    await saveFile(new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }),
      `todo-${compat ? "v1" : "v2"}-${day.value}.json`);
  } catch (e) {
    ElMessage.error((e as Error).message);
  } finally {
    busy.value = false;
  }
}
async function pickFile(event: Event) {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  if (!file) return;
  if (file.size > 5_000_000) {
    ElMessage.error("文件不能超过 5 MB");
    input.value = "";
    return;
  }
  preview.value = null;
  busy.value = true;
  fileName.value = file.name;
  try {
    preview.value = await post<ImportPreview>("/imports/preview", {
      content: await file.text(),
      scope: importScope.value,
    });
  } catch (e) {
    ElMessage.error((e as Error).message);
  } finally {
    busy.value = false;
    input.value = "";
  }
}
async function confirmImport() {
  if (!preview.value) return;
  const id = preview.value.id;
  await run(async () => {
    await post("/imports/" + id + "/confirm");
    preview.value = null;
  }, "导入完成");
}
watch([view, dataTab], ([currentView], [previousView]) => {
  search.value = "";
  error.value = "";
  void refresh();
  const switchingChecklist=['today','tasks'].includes(currentView) && ['today','tasks'].includes(previousView);
  if(!switchingChecklist || !userSettings.value)void loadSettings();
});
watch(day,refresh);
onMounted(()=>{mobileMedia.addEventListener('change',syncMobileLayout);void refresh();void loadSettings();});
onUnmounted(()=>{mobileMedia.removeEventListener('change',syncMobileLayout);clearInterval(timer);window.clearTimeout(reminderHideTimer);});
</script>
<template>
  <div class="workspace" :class="{'workspace-ai': aiChat, 'sidebar-hidden': sidebarHidden, 'workspace-desktop-chat':desktopChat, 'workspace-desktop-compact':desktopCompact}">
    <button v-if="sidebarHidden" ref="sidebarToggle" type="button" class="sidebar-toggle sidebar-reopen" aria-label="展开侧边栏" title="展开侧边栏" aria-controls="workspace-sidebar" :aria-expanded="false" @click="toggleSidebar"><el-icon><Expand /></el-icon></button>
    <aside id="workspace-sidebar" v-show="!sidebarHidden" class="sidebar">
      <div class="sidebar-header"><ThemePicker @saved="applySettings"/><router-link class="mobile-account" to="/account" aria-label="个人账户"><span class="avatar">{{ auth.avatarLetter }}</span><span>个人账户</span></router-link><button v-if="!sidebarHidden" ref="sidebarToggle" type="button" class="sidebar-toggle" aria-label="收起侧边栏" title="收起侧边栏" aria-controls="workspace-sidebar" :aria-expanded="true" @click="toggleSidebar"><el-icon><Fold /></el-icon></button></div>
      <nav aria-label="工作区">
        <router-link
          v-for="item in nav"
          :key="item.id"
          :to="'/' + item.id"
          class="nav-item"
          :class="{ active: item.id==='tasks' ? isChecklist : view === item.id }"
          :aria-current="(item.id==='tasks' ? isChecklist : view===item.id)?'page':undefined"
          ><el-icon><component :is="item.icon" /></el-icon
          ><span>{{ item.title }}</span
          ><span v-if="item.id === 'tasks'" class="nav-count">{{
            activeCount
          }}</span
          ></router-link
        >
      </nav>
      <div class="account">
        <router-link class="account-link" :class="{active:view==='account'}" to="/account" aria-label="个人账户">
        <div class="avatar">
          {{ auth.avatarLetter }}
        </div>
        <div>
          <span>个人账户</span>
        </div>
        <el-icon><Setting /></el-icon></router-link>
      </div>
    </aside>
    <main class="workspace-main" :class="{'workspace-main-ai': aiChat, 'workspace-today': isChecklist, 'workspace-focus':view==='focus'}">
      <nav v-if="desktopShell" class="desktop-view-switch" aria-label="桌面页面切换">
        <router-link to="/ai" :class="{active:view==='ai'}" :aria-current="view==='ai'?'page':undefined"><el-icon><ChatDotRound/></el-icon>聊天</router-link>
        <router-link to="/today" :class="{active:isChecklist}" :aria-current="isChecklist?'page':undefined"><el-icon><List/></el-icon>清单</router-link>
        <router-link to="/focus" :class="{active:view==='focus'}" :aria-current="view==='focus'?'page':undefined"><el-icon><Timer/></el-icon>专注</router-link>
      </nav>
      <header v-if="!aiChat && !['food','calendar','focus','news','pet','data','stats','account'].includes(view)" class="page-header" :class="{'today-header':isChecklist}">
        <div :class="{'today-header-identity':isChecklist}">
          <div :class="{'today-meta':isChecklist}">
          <p v-if="view!=='account'" class="eyebrow">
            {{ day }} ·
            {{
              new Intl.DateTimeFormat("zh-CN", {
                timeZone: auth.user?.timezone,
                weekday: "long",
              }).format(new Date())
            }}
          </p>
          <div v-if="isChecklist" class="today-weather" role="status" aria-label="今日天气"><el-icon><Sunny/></el-icon><span v-if="weatherBusy">{{userSettings?.weather_city || ''}}天气加载中…</span><template v-else-if="weather"><span>{{weather.city}} · {{weather.current.temperature_2m}}°C</span><button type="button" aria-label="刷新天气" @click="retryWeather"><el-icon><Refresh/></el-icon></button></template><template v-else-if="weatherError"><span>{{weatherError}}</span><button type="button" @click="retryWeather">重试</button></template><span v-else>天气未开启</span><router-link v-if="!weatherBusy" to="/account">{{weather?'更换城市':'设置天气'}}</router-link></div>
          </div>
          <h1>{{ title }}</h1>
        </div>
        <el-button
          v-if="isChecklist"
          type="primary"
          :icon="Plus"
          :disabled="busy"
          @click="open()"
          >新建任务</el-button
        >
      </header>
      <nav v-if="isChecklist" class="checklist-period-tabs" aria-label="清单周期">
        <router-link v-for="item in checklistPeriods" :key="item.id" :to="{path:'/tasks',query:item.id==='today'?{}:{period:item.id}}" :class="{active:period===item.id}" :aria-current="period===item.id?'page':undefined">{{item.title}}</router-link>
      </nav>
      <p v-if="isChecklist && !isDaily" class="checklist-range" role="status" aria-label="清单日期范围">{{periodRange.start}}{{periodRange.start===periodRange.end?'':' ～ '+periodRange.end}}<span>按截止日期与今日安排归入清单，逾期未完成任务继续显示。</span></p>
      <nav v-if="view==='data'" class="data-tabs" aria-label="数据管理项目"><router-link to="/data" :class="{active:dataTab==='export'}">导出数据</router-link><router-link to="/data?tab=backup" :class="{active:dataTab==='backup'}">备份与导入</router-link><router-link to="/data?tab=trash" :class="{active:dataTab==='trash'}">垃圾站<span v-if="tasks.trash.length"> {{ tasks.trash.length }}</span></router-link></nav>
      <el-alert
        v-if="error"
        :title="error"
        type="error"
        :closable="false"
        show-icon
        role="alert"
        ><el-button text :icon="Refresh" @click="refresh"
          >重试</el-button
        ></el-alert
      >
      <template v-if="isChecklist || isTrash">
        <p v-if="isTrash" class="page-description">移入垃圾站的任务可以恢复；永久删除前会再次确认。</p>
        <div v-if="isChecklist" class="today-list-heading"><h2>任务清单</h2><span>{{scheduledCount}} 项</span></div>
        <div class="list-toolbar" :class="{'today-list-toolbar':isChecklist}">
          <el-segmented
            v-model="scope"
            :options="[
              { label: '全部', value: 'all' },
              { label: '工作', value: 'work' },
              { label: '生活', value: 'life' },
              { label: '学习', value: 'study' },
              { label: '未分类', value: 'unassigned' },
            ]"
            aria-label="任务范围"
          /><el-input
            v-model="search"
            class="search-input"
            :prefix-icon="Search"
            placeholder="搜索任务或备注"
            aria-label="搜索任务"
            clearable
          />
        </div>
        <form
          v-if="!isTrash && !isDaily"
          class="quick-add"
          @submit.prevent="quickAdd"
        >
          <el-icon><Plus /></el-icon
          ><input
            v-model="quickTitle"
            aria-label="快速记录任务"
            maxlength="500"
            placeholder="记下一件事，例如：买牛奶"
            :disabled="busy"
          /><el-button
            text
            native-type="submit"
            :disabled="busy || !quickTitle.trim()"
            :loading="busy"
            :icon="ArrowRight"
            aria-label="记录任务"
            >记录</el-button
          >
        </form>
        <div v-if="!isTrash" class="list-subtoolbar" :class="{'today-list-subtoolbar':isChecklist}">
          <el-select
            v-model="status"
            class="status-select"
            aria-label="筛选状态"
            ><el-option label="待办与进行中" value="active" /><el-option
              label="全部状态"
              value="all" /><el-option label="已完成" value="done" /><el-option
              label="失败"
              value="failed" /><el-option
              label="已取消"
              value="cancelled" /></el-select
          ><el-checkbox v-model="showHidden">显示隐藏任务</el-checkbox
          ><el-button
            text
            :icon="Refresh"
            :disabled="tasks.loading || busy"
            aria-label="刷新"
            @click="refresh"
            ><span class="toolbar-refresh-label">刷新</span></el-button
          >
        </div>
        <p v-if="isTrash" class="muted">
          恢复会同时恢复该次删除的子任务。垃圾站保留 30 天，到期由后台清理；永久删除无法撤销。
        </p>
        <section class="task-list" :aria-busy="tasks.loading">
          <p v-if="tasks.loading" class="loading-note" role="status">
            正在读取清单…
          </p>
          <template v-for="(group,index) in taskGroups" :key="group[0]!.task.id">
          <div v-if="isChecklist && !isScheduledGroup(group) && (!index || isScheduledGroup(taskGroups[index-1]!))" class="checklist-unscheduled-heading"><h2>待安排</h2><span>{{unscheduledCount}} 项 · 未设截止日期</span><p>设置截止日期或加入今日安排，即可放入对应清单。</p></div>
          <div class="task-card-group" :data-planning="isChecklist?(isScheduledGroup(group)?'scheduled':'unscheduled'):undefined">
          <TaskRow
            v-for="row in group"
            :key="row.task.id"
            :task="row.task"
            :depth="row.depth"
            :busy="busy || tasks.loading"
            :planned="planned.has(row.task.id)"
            :trash="isTrash"
            :timezone="auth.user?.timezone || 'Asia/Shanghai'"
            :workflow="workflowFor(row.task, tasks.items)"
            @edit="open($event)"
            @toggle="toggle"
            @status="changeStatus"
            @child="open(null, $event)"
            @plan="togglePlan"
            @trash="trash"
            @restore="run(() => tasks.restore($event), '任务已恢复')"
            @purge="purge"
          />
          </div>
          </template>
          <div v-if="!tasks.loading && !visibleRows.length" class="empty-state">
            <el-icon
              ><component :is="isTrash ? Delete : List"
            /></el-icon>
            <h3>
              {{
                search
                  ? "没有找到匹配任务"
                  : isChecklist
                    ? periodTasks.length ? '当前筛选下没有任务' : isDaily ? '今天还没有安排任务' : '这段时间还没有任务'
                    : isTrash
                      ? "垃圾站是空的"
                      : "从第一件小事开始。"
              }}
            </h3>
            <p>
              {{
                search
                  ? "试试其他关键词，或调整筛选条件。"
                  : isChecklist
                    ? periodTasks.length ? '调整分类或状态，查看其他任务。' : '记下一件事，或切换周期查看其他清单。'
                    : isTrash
                      ? "移入垃圾站的任务会显示在这里。"
                      : "记录工作、生活与学习，再按自己的节奏推进。"
              }}
            </p>
            <router-link v-if="isDaily && !periodTasks.length" to="/tasks?period=year"
              >查看年度清单 <el-icon><ArrowRight /></el-icon
            ></router-link>
          </div>
        </section>
        <p v-if="!isDaily" class="list-footnote">{{ visibleRows.length }} 条记录</p>
      </template>
      <ExportPanel v-else-if="view==='data' && dataTab==='export'"/>
      <section v-else-if="view === 'data' && dataTab==='backup'" class="data-page">
        <p class="page-description">
          让旧清单接着走，也为现在的进度留一份备份。
        </p>
        <section class="data-section">
          <div class="section-heading">
            <el-icon><Upload /></el-icon>
            <h2>导入清单</h2>
          </div>
          <p>
            从 1.0「数据管理」导出 JSON，再在这里预览。支持 1.0 任务数组与 2.0
            任务备份；AI Key 不导入。
          </p>
          <div class="import-controls">
            <el-select
              v-model="importScope"
              aria-label="导入默认范围"
              :disabled="busy"
              ><el-option label="默认未分类" value="unassigned" /><el-option
                label="默认归入工作"
                value="work" /><el-option
                label="默认归入生活"
                value="life" /><el-option
                label="默认归入学习"
                value="study" /></el-select
            ><el-button
              type="primary"
              :icon="Upload"
              :disabled="busy"
              :loading="busy"
              @click="inputFile?.click()"
              >选择 JSON 文件</el-button
            ><input
              ref="inputFile"
              type="file"
              accept=".json,application/json"
              class="visually-hidden"
              aria-label="导入文件"
              @change="pickFile"
            />
          </div>
          <div v-if="preview" class="import-preview">
            <h3>{{ fileName }}</h3>
            <p>
              {{ preview.count }} 条任务 · {{ preview.children }} 条子任务 ·
              已完成 {{ preview.status_counts.done }} 条 · 失败
              {{ preview.status_counts.failed }} 条 ·
              {{ preview.history_count }} 条历史 ·
              {{ preview.plan_count }} 条安排
            </p>
            <el-alert
              v-if="preview.confirmed"
              title="此文件已导入，不会重复创建任务。"
              type="info"
              :closable="false"
            />
            <ul v-if="preview.issues.length" class="import-issues">
              <li v-for="(issue, i) in preview.issues" :key="i">
                第 {{ issue.row }} 条：{{ issue.message }}
              </li>
            </ul>
            <ul v-if="preview.warnings.length" class="import-warnings">
              <li v-for="(warning, i) in preview.warnings" :key="i">
                {{ warning }}
              </li>
            </ul>
            <el-table
              v-if="!preview.confirmed"
              :data="preview.items"
              max-height="320"
              size="small"
              ><el-table-column
                prop="legacy_id"
                label="原 ID"
                width="90" /><el-table-column
                prop="fields.title"
                label="名称"
                min-width="160" /><el-table-column
                prop="fields.status"
                label="新状态"
                width="100" /><el-table-column
                prop="legacy_parent_id"
                label="父 ID"
                width="90" /><el-table-column
                prop="fields.due_date"
                label="截止日期"
                width="130" /></el-table
            ><el-button
              v-if="!preview.confirmed"
              class="confirm-import"
              type="primary"
              :disabled="busy || !!preview.issues.length"
              @click="confirmImport"
              >确认导入 {{ preview.count }} 条任务</el-button
            >
            <p v-if="preview.issues.length" class="field-hint">
              先修正文件中的异常，再重新选择文件预览。异常项不会被静默跳过。
            </p>
          </div>
        </section>
        <section class="data-section">
          <div class="section-heading">
            <el-icon><Download /></el-icon>
            <h2>导出备份</h2>
          </div>
          <p>
            2.0 备份包含任务、变更历史和今日安排，不包含密码、会话或模型凭据。
          </p>
          <div class="export-buttons">
            <el-button
              :disabled="busy"
              :icon="Download"
              @click="exportData(false)"
              >导出 2.0 备份</el-button
            ><el-button :disabled="busy" @click="exportData(true)"
              >导出兼容 1.0 的任务</el-button
            >
          </div>
          <p class="field-hint">
            兼容导出仅包含有效任务；工作／生活／学习范围、今日安排及历史无法回填
            1.0。进行中与取消映射为待办；1.0 可能自行补填未知的完成时间。
          </p>
        </section>
      </section>
      <RecommendationPanel v-else-if="view==='news'"/>
      <StatisticsPanel v-else-if="view==='stats'" @open="open"/>
      <DesktopPetPanel v-else-if="view==='pet'"/>
      <AdminPanel v-else-if="view==='admin' && auth.user?.is_admin"/>
      <FoodPanel v-else-if="view==='food'"/>
      <PlanningPanel v-else-if="['calendar','recurrences'].includes(view)" :view="view" :recurrence-revision="recurrenceRevision" @create-recurrence="openRecurrence"/>
      <section v-else-if="view==='account'" class="account-page">
        <SettingsPanel :appearance="userSettings" @saved="applySettings" @notification-preview="previewDueNotification"/>
      </section>
      <AIAssistant v-if="chatVisited" v-show="aiChat" :active="aiChat" :key="'ai'"/>
      <FocusPanel v-if="focusVisited || view==='focus'" v-show="view==='focus'" :visible="view==='focus'" :key="'focus'"/>
    </main>
    <DueNotifications :tasks="notificationPreview?[notificationPreview]:dueReminders" :timezone="auth.user?.timezone || 'Asia/Shanghai'" :preview="Boolean(notificationPreview)" @open="openDue" @dismiss="dismissDue" @clear="clearDue"/>
    <TaskEditor
      v-model="editor"
      :task="selected"
      :parent="parent"
      :scope="(scope === 'all' ? 'unassigned' : scope) as Scope"
      :automatic-scope="scope === 'all'"
      :initial-recurrence="initialRecurrence"
      :busy="busy"
      :readonly="isTrash"
      :timezone="auth.user?.timezone || 'Asia/Shanghai'"
      @save="save"
    />
    <TaskStatusDialog v-if="pendingStatus" v-model="statusDialogOpen" :mode="pendingStatus.mode" :title="pendingStatus.task.title" :fields="pendingStatus.fields" :failed-children="workflowFor(pendingStatus.task, tasks.items).failed_children" :busy="busy" @save="confirmStatus"/>
  </div>
</template>
