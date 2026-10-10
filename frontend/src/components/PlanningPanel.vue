<script setup lang="ts">
import {computed,nextTick,onMounted,onUnmounted,ref,watch} from 'vue';
import {ElMessageBox} from 'element-plus';
import {ArrowLeft,ArrowRight,Calendar} from '@element-plus/icons-vue';
import {api} from '../api';
import {useTasks,localDate} from '../stores/tasks';
import {useAuth} from '../stores/auth';
import type {Task} from '../types';
import type {Rule} from '../advanced-types';
import CalendarDateWheel from './CalendarDateWheel.vue';
import {shiftCalendarDate,monthDays} from '../calendar-date';
import {dateTimeInZone} from '../task-deadline';
const props=defineProps<{view:string;recurrenceRevision?:number}>();
const emit=defineEmits<{'create-recurrence':[]}>();
const tasks=useTasks(),auth=useAuth();
const accountToday=()=>localDate(auth.user?.timezone||'Asia/Shanghai');
const busy=ref(false),error=ref(''),calendarDate=ref(new Date(accountToday()+'T12:00:00')),selectedTask=ref(''),rules=ref<Rule[]>([]);
const wheelOpen=ref(false),calendarLoading=ref(false);
let calendarRequest=0;
type Entry={date:string;kind:'due'|'plan';plan_id?:string;task:Task};
type DailyTask={task:Task;due:boolean;planned:boolean;plan_id?:string};
const entries=ref<Entry[]>([]);
const recurrenceForm=ref({title:'',scope:'work',frequency:'daily',interval:1,mode:'calendar',start_date:localDate(auth.user?.timezone||'Asia/Shanghai')});
const editRule=ref<Rule|null>(null);
const frequencyLabels:Record<string,string>={daily:'天',weekly:'周',monthly:'个月'};
const activeTasks=computed(()=>tasks.items.filter(t=>['todo','doing'].includes(t.status)));
function dateString(d:Date){return `${String(d.getFullYear()).padStart(4,'0')}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;}
const selectedDate=computed(()=>dateString(calendarDate.value));
const wheelDate=computed({get:()=>selectedDate.value,set:(value:string)=>{calendarDate.value=new Date(value+'T12:00:00');}});
const calendarMonth=computed(()=>selectedDate.value.slice(0,7));
const today=computed(accountToday);
const selectedWeekday=computed(()=>['星期日','星期一','星期二','星期三','星期四','星期五','星期六'][calendarDate.value.getDay()]);
function changeMonth(amount:number){wheelDate.value=shiftCalendarDate(selectedDate.value,'month',amount);}
function chooseToday(){wheelDate.value=accountToday();}
const days=computed(()=>{
  const grouped=new Map<string,Map<string,DailyTask>>();
  for(const entry of entries.value){
    let day=grouped.get(entry.date);
    if(!day){day=new Map();grouped.set(entry.date,day);}
    let row=day.get(entry.task.id);
    if(!row){row={task:entry.task,due:false,planned:false};day.set(entry.task.id,row);}
    if(entry.kind==='due')row.due=true;
    else {row.planned=true;row.plan_id=entry.plan_id;}
  }
  return new Map([...grouped].map(([date,tasks])=>{
    const rows=[...tasks.values()];
    return [date,{rows,planned:rows.filter(row=>row.planned).length,due:rows.filter(row=>row.due).length}];
  }));
});
const dailyEntries=computed(()=>days.value.get(selectedDate.value)?.rows || []);
const monthCounts=computed(()=>[...days.value.values()].reduce((total,day)=>({planned:total.planned+day.planned,due:total.due+day.due}),{planned:0,due:0}));
function dayLabel(date:string){
  const day=days.value.get(date);
  return `${date}${date===today.value?'，今天':''}，${day?.rows.length || 0} 项任务${day?.planned?'，'+day.planned+' 项安排':''}${day?.due?'，'+day.due+' 项截止':''}`;
}
const markerCount=(count:number)=>count>99?'99+':count;
async function moveDay(event:KeyboardEvent,date:string){
  const steps:Record<string,number>={ArrowLeft:-1,ArrowRight:1,ArrowUp:-7,ArrowDown:7};
  if(!(event.key in steps))return;
  event.preventDefault();wheelDate.value=shiftCalendarDate(date,'day',steps[event.key]!);
  await nextTick();document.querySelector<HTMLButtonElement>(`button[data-calendar-date="${selectedDate.value}"]`)?.focus();
}
function deadline(task:Task){
  return task.due_date || (task.due_at?dateTimeInZone(new Date(task.due_at),auth.user?.timezone||'Asia/Shanghai').replace('T',' '):'');
}
async function act(fn:()=>Promise<void>){busy.value=true;error.value='';try{await fn();}catch(e){error.value=(e as Error).message;}finally{busy.value=false;}}
async function load(){
  const view=props.view;
  await tasks.refresh(localDate(auth.user?.timezone||'Asia/Shanghai'));
  if(view!==props.view)return;
  if(props.view==='calendar')await loadCalendar();
  if(props.view==='recurrences')rules.value=await api('/recurrences');
}
async function loadCalendar(){
  const request=++calendarRequest;
  const start=calendarMonth.value+'-01',end=calendarMonth.value+'-'+monthDays(calendarDate.value.getFullYear(),calendarDate.value.getMonth()+1);
  entries.value=[];calendarLoading.value=true;error.value='';
  try{
    const result=await api<Entry[]>('/calendar?'+new URLSearchParams({start,end}));
    if(request===calendarRequest && props.view==='calendar')entries.value=result;
  }catch(e){if(request===calendarRequest)error.value=(e as Error).message;}
  finally{if(request===calendarRequest)calendarLoading.value=false;}
}
async function plan(){await act(async()=>{const task=tasks.items.find(t=>t.id===selectedTask.value);if(task)await tasks.plan(task,selectedDate.value);await load();});}
async function unplan(id:string){await act(async()=>{await api('/daily-plans/'+id,{method:'DELETE'});await load();});}
async function saveRule(){await act(async()=>{
  if (!editRule.value) return;
  const f=recurrenceForm.value;
  const payload={template:{...editRule.value.template,title:f.title,scope:f.scope},frequency:f.frequency,interval:f.interval,mode:f.mode,start_date:f.start_date};
  await api('/recurrences/'+editRule.value.id+'?version='+editRule.value.version,{method:'PUT',body:JSON.stringify(payload)});
  editRule.value=null;f.title='';await load();
});}
function edit(rule:Rule){editRule.value=rule;recurrenceForm.value={title:rule.template.title,scope:rule.template.scope,frequency:rule.frequency,interval:rule.interval,mode:rule.mode,start_date:rule.next_date||localDate(auth.user?.timezone||'Asia/Shanghai')};}
async function stopRule(rule:Rule){try{await ElMessageBox.confirm('停止自动生成后续任务？已有实例保留。','停止周期');}catch{return;}await act(async()=>{await api('/recurrences/'+rule.id,{method:'DELETE'});await load();});}
watch(()=>props.view,()=>{calendarRequest++;calendarLoading.value=false;wheelOpen.value=false;void act(load);});
watch(calendarMonth,()=>{if(props.view==='calendar')void loadCalendar();});
watch(()=>props.recurrenceRevision,()=>{if(props.view==='recurrences')void act(load);});
onMounted(()=>act(load));
onUnmounted(()=>{calendarRequest++;});
</script>
<template><section class="feature-page" :class="{'planning-calendar':view==='calendar'}"><el-alert v-if="error" :title="error" type="error" :closable="false" role="alert"><el-button v-if="view==='calendar'" text :disabled="calendarLoading" @click="loadCalendar">重试</el-button></el-alert>
<template v-if="view==='calendar'">
  <el-calendar v-model="calendarDate" class="planning-month" :aria-busy="calendarLoading">
    <template #header>
      <div class="calendar-toolbar">
        <strong class="calendar-month-title"><span>{{calendarDate.getFullYear()}} 年</span>{{calendarDate.getMonth()+1}} 月</strong>
        <div class="calendar-controls">
          <el-button class="calendar-date-picker" :icon="Calendar" :disabled="busy" aria-label="滚轮选择日期" aria-haspopup="dialog" @click="wheelOpen=true">选择日期</el-button>
          <div class="calendar-navigation" role="group" aria-label="切换月份">
            <el-button :icon="ArrowLeft" :disabled="busy" aria-label="上个月" title="上个月" @click="changeMonth(-1)"/>
            <el-button :disabled="busy" @click="chooseToday">今天</el-button>
            <el-button :icon="ArrowRight" :disabled="busy" aria-label="下个月" title="下个月" @click="changeMonth(1)"/>
          </div>
        </div>
      </div>
    </template>
    <template #date-cell="{data}">
      <button type="button" class="calendar-day-content" :class="{'is-outside':data.type!=='current-month','is-account-today':data.day===today,'has-tasks':days.has(data.day)}" :data-calendar-date="data.day" :aria-label="dayLabel(data.day)" :aria-pressed="data.isSelected" :aria-current="data.day===today?'date':undefined" :tabindex="data.isSelected?0:-1" @keydown="moveDay($event,data.day)">
        <span class="calendar-day-top"><span class="calendar-day-number">{{Number(data.day.slice(-2))}}</span><span v-if="data.day===today" class="calendar-today-label">今天</span></span>
        <span class="calendar-day-marks" aria-hidden="true">
          <span v-if="days.get(data.day)?.planned" class="calendar-marker calendar-marker-plan"><i/><span class="calendar-marker-label">安排 </span><span class="calendar-marker-count">{{markerCount(days.get(data.day)!.planned)}}</span></span>
          <span v-if="days.get(data.day)?.due" class="calendar-marker calendar-marker-due"><i/><span class="calendar-marker-label">截止 </span><span class="calendar-marker-count">{{markerCount(days.get(data.day)!.due)}}</span></span>
        </span>
        <span v-if="days.has(data.day)" class="calendar-day-preview" aria-hidden="true">
          <span v-for="entry in days.get(data.day)!.rows.slice(0,2)" :key="entry.task.id" :class="{'is-complete':entry.task.status==='done'}">{{entry.task.title}}</span>
          <span v-if="days.get(data.day)!.rows.length>2" class="calendar-day-more">另有 {{days.get(data.day)!.rows.length-2}} 项任务</span>
        </span>
      </button>
    </template>
  </el-calendar>
  <div class="calendar-legend" aria-label="日历标记说明"><span class="calendar-marker calendar-marker-plan"><i/>安排<span v-if="!calendarLoading && !error"> {{monthCounts.planned}}</span></span><span class="calendar-marker calendar-marker-due"><i/>截止<span v-if="!calendarLoading && !error"> {{monthCounts.due}}</span></span><span class="calendar-legend-note">本月 · 安排与截止分别记录</span></div>
  <section class="feature-section calendar-agenda" :aria-busy="calendarLoading" aria-label="所选日期任务">
    <header class="calendar-agenda-header"><div><span class="calendar-agenda-eyebrow">{{selectedDate===today?'今天的安排':'日期安排'}} · {{selectedWeekday}}</span><h2>{{selectedDate}}</h2></div><span v-if="!calendarLoading && !error" class="calendar-agenda-count">{{dailyEntries.length}} 项任务</span></header>
    <form class="calendar-plan-form" @submit.prevent="plan"><el-select v-model="selectedTask" filterable placeholder="选择任务，安排到这一天" aria-label="安排任务"><el-option v-for="t in activeTasks" :key="t.id" :value="t.id" :label="t.title"/></el-select><el-button native-type="submit" :disabled="busy || !selectedTask">加入此日安排</el-button></form>
    <p v-if="calendarLoading" class="muted" role="status">正在读取日期安排…</p>
    <article v-else v-for="entry in dailyEntries" :key="entry.task.id" class="evidence-row calendar-task-row">
      <div class="calendar-task-info">
        <strong class="calendar-task-title">{{entry.task.title}}</strong>
        <el-tag v-if="entry.task.due_date || entry.task.due_at" :type="entry.due?'warning':'info'" size="small" class="calendar-task-deadline">截止 <time :datetime="entry.task.due_date || entry.task.due_at || undefined">{{deadline(entry.task)}}</time></el-tag>
      </div>
      <div v-if="entry.planned" class="calendar-task-actions">
        <el-tag v-if="entry.planned" type="success" size="small">安排</el-tag>
        <el-button v-if="entry.plan_id" text :disabled="busy" @click="unplan(entry.plan_id)">移出安排</el-button>
      </div>
    </article>
    <div v-if="!calendarLoading && !error && !dailyEntries.length" class="calendar-empty"><el-icon><Calendar/></el-icon><div><strong>这一天还没有安排或截止任务。</strong><p>从上方选择任务，给这一天留一点计划。</p></div></div>
  </section>
  <el-dialog v-model="wheelOpen" title="选择日期" width="min(420px, calc(100vw - 32px))" top="15vh" destroy-on-close><CalendarDateWheel v-model="wheelDate"/><template #footer><el-button @click="chooseToday">返回今天</el-button><el-button type="primary" @click="wheelOpen=false">完成</el-button></template></el-dialog>
</template>
<template v-else><p class="page-description">在新建任务中设置重复周期；在这里管理后续规则。</p><div class="action-row"><el-button type="primary" @click="emit('create-recurrence')">新建任务</el-button></div><p v-if="!rules.length && !busy" class="muted">还没有周期任务，在新建任务中选择重复频率即可创建。</p><section v-if="editRule" class="feature-section"><h2>编辑后续规则</h2><form @submit.prevent="saveRule"><div class="form-grid"><label>任务名称<el-input v-model="recurrenceForm.title" aria-label="周期任务名称" maxlength="500"/></label><label>范围<el-select v-model="recurrenceForm.scope" aria-label="周期任务范围"><el-option label="工作" value="work"/><el-option label="生活" value="life"/><el-option label="学习" value="study"/></el-select></label><label>频率<el-select v-model="recurrenceForm.frequency" aria-label="周期频率"><el-option label="每天" value="daily"/><el-option label="每周" value="weekly"/><el-option label="每月" value="monthly"/></el-select></label><label>间隔<el-input-number v-model="recurrenceForm.interval" :min="1" :max="365" aria-label="周期间隔"/></label><label>生成方式<el-select v-model="recurrenceForm.mode" aria-label="周期生成方式"><el-option label="固定日历周期" value="calendar"/><el-option label="完成后间隔" value="after_completion"/></el-select></label><label>开始日期<input type="date" v-model="recurrenceForm.start_date" aria-label="周期开始日期"/></label></div><details class="help-disclosure"><summary>周期计算说明</summary><p>固定月周期会保留原日号，月份没有该日时取月末；完成后间隔从实际完成日计算。</p></details><div class="action-row"><el-button type="primary" native-type="submit" :disabled="busy || !recurrenceForm.title.trim()">保存后续规则</el-button><el-button v-if="editRule" @click="editRule=null">取消编辑</el-button></div></form></section><article v-for="r in rules" :key="r.id" class="evidence-row"><h3>{{r.template.title}}</h3><p class="muted">每 {{r.interval}} {{frequencyLabels[r.frequency] || r.frequency}} · {{r.mode==='calendar'?'固定日历':'完成后间隔'}} · {{r.enabled?'下一次 '+(r.next_date||'等待上次完成'):'已停止'}}</p><div class="action-row" v-if="r.enabled"><el-button :disabled="busy" @click="edit(r)">编辑后续规则</el-button><el-button :disabled="busy" @click="stopRule(r)">停止后续</el-button></div></article></template>
</section></template>

<style scoped>
.planning-calendar{--calendar-due-color:#a55d27;--calendar-due-bg:#fcf0e4}
:global(html[data-theme="dark"] .planning-calendar){--calendar-due-color:#e7b37e;--calendar-due-bg:#3c3329}
.planning-month{background:transparent}
.planning-calendar :deep(.el-calendar__header){padding:12px 0 20px;border-bottom:0}
.calendar-toolbar{display:flex;align-items:center;justify-content:space-between;gap:16px;width:100%}
.calendar-month-title{display:flex;align-items:baseline;gap:12px;white-space:nowrap;font-size:30px;font-weight:600;letter-spacing:-.04em;font-variant-numeric:tabular-nums;color:var(--el-text-color-primary)}
.calendar-month-title>span{font-size:15px;font-weight:500;letter-spacing:0;color:var(--el-text-color-secondary)}
.calendar-controls,.calendar-navigation{display:flex;align-items:center;gap:8px}
.calendar-controls .el-button+.el-button{margin-left:0}
.calendar-navigation{gap:0;border:1px solid var(--el-border-color);border-radius:8px;overflow:hidden}
.calendar-navigation .el-button{border:0;border-radius:0;background:transparent;height:38px;padding:0 14px}
.calendar-navigation .el-button:first-child,.calendar-navigation .el-button:last-child{width:38px;padding:0}
.calendar-navigation .el-button:hover{background:var(--el-fill-color-light)}
.calendar-date-picker{height:40px;background:transparent}
.planning-calendar :deep(.el-calendar__body){padding:0;max-width:910px;margin:0 auto}
.planning-calendar :deep(.el-calendar-table thead th){padding:16px 0;font-size:12px;font-weight:500;color:var(--el-text-color-secondary)}
.planning-calendar :deep(.el-calendar-table td),
.planning-calendar :deep(.el-calendar-table tr:first-child td),
.planning-calendar :deep(.el-calendar-table tr td:first-child){border:0}
.planning-calendar :deep(.el-calendar-table td.is-today){color:inherit}
.planning-calendar :deep(.el-calendar-table td.is-selected){background:transparent}
.planning-calendar :deep(.el-calendar-table .el-calendar-day){height:auto;padding:4px}
.planning-calendar :deep(.el-calendar-day:hover){background:transparent}
.calendar-day-content{display:flex;flex-direction:column;width:100%;aspect-ratio:1;min-height:116px;min-width:0;text-align:left;border:0;border-radius:14px;padding:8px;background:transparent;color:var(--el-text-color-primary);transition:background-color .16s ease;font-variant-numeric:tabular-nums}
.calendar-day-content:hover{background:var(--el-fill-color-light)}
.calendar-day-content:focus-visible{outline:2px solid var(--el-color-primary);outline-offset:-3px}
.calendar-day-content.is-outside{color:var(--el-text-color-disabled)}
.calendar-day-top{display:flex;align-items:center;justify-content:center;position:relative;width:100%;gap:4px}
.calendar-day-number{display:inline-grid;place-items:center;width:30px;height:30px;border-radius:50%;font-size:15px;font-weight:500}
.is-account-today .calendar-day-number{box-shadow:inset 0 0 0 1px var(--el-color-primary);color:var(--el-color-primary)}
.calendar-day-content[aria-pressed="true"] .calendar-day-number{background:var(--el-color-primary);color:var(--workbench-button-text,#fff);font-weight:600}
.calendar-today-label{position:absolute;right:0;font-size:11px;color:var(--el-color-primary)}
.calendar-day-marks{display:flex;align-items:center;justify-content:center;flex-wrap:wrap;gap:4px 8px;margin:4px 0 0;font-size:11px;line-height:1.4}
.calendar-marker{display:inline-flex;align-items:center;gap:4px;white-space:nowrap;font-variant-numeric:tabular-nums}
.calendar-marker>i{width:5px;height:5px;display:inline-block;background:currentColor;flex-shrink:0}
.calendar-marker-plan{color:var(--el-color-primary)}
.calendar-marker-plan>i{border-radius:50%}
.calendar-marker-due{color:var(--calendar-due-color)}
.calendar-marker-due>i{transform:rotate(45deg)}
.calendar-day-preview{display:grid;gap:4px;margin-top:6px;font-size:12px;line-height:1.25;min-width:0;width:100%;text-align:center;color:var(--el-text-color-regular)}
.calendar-day-preview>span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.calendar-day-preview>.calendar-day-more{font-size:10px;color:var(--el-text-color-secondary)}
.calendar-day-preview>.is-complete{text-decoration:line-through;color:var(--el-text-color-secondary)}
.calendar-legend{display:flex;align-items:center;flex-wrap:wrap;gap:10px 20px;padding:14px 4px;font-size:12px}
.calendar-legend .calendar-marker{gap:7px}
.calendar-legend-note{color:var(--el-text-color-secondary);margin-left:auto;font-size:12px}
.planning-calendar .calendar-agenda{padding:28px 0 0;border-top:1px solid var(--el-border-color-light);margin-top:12px}
.calendar-agenda-header{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:20px}
.calendar-agenda-eyebrow{display:block;font-size:12px;color:var(--el-text-color-secondary);margin-bottom:6px}
.calendar-agenda-header h2{font-size:24px;font-weight:600;letter-spacing:-.03em;margin:0;line-height:1.4;font-variant-numeric:tabular-nums}
.calendar-agenda-count{font-size:13px;color:var(--el-text-color-secondary);white-space:nowrap}
.calendar-plan-form{display:flex;align-items:center;gap:10px;margin-bottom:16px}
.calendar-plan-form .el-select{width:min(360px,100%);min-width:0}
.calendar-plan-form>.el-button{flex-shrink:0}
.calendar-task-row{display:flex;align-items:center;justify-content:space-between;gap:20px;padding:20px 0}
.calendar-task-info{flex:1;min-width:0;display:flex;align-items:center;flex-wrap:wrap;gap:10px 20px}
.calendar-task-title{min-width:0;font-size:15px;font-weight:500;overflow-wrap:anywhere;line-height:1.6}
.calendar-task-deadline{width:fit-content;max-width:100%;height:auto;padding:4px 8px;line-height:1.5;white-space:normal}
.calendar-task-deadline.el-tag--warning{color:var(--calendar-due-color);background:var(--calendar-due-bg);border-color:transparent}
.calendar-task-deadline time{font:inherit;color:inherit;font-variant-numeric:tabular-nums;white-space:nowrap}
.calendar-task-actions{display:flex;align-items:center;gap:12px;flex-shrink:0}
.calendar-task-actions .el-tag--success{color:var(--el-color-primary);background:var(--el-color-primary-light-9);border-color:transparent}
.calendar-empty{display:flex;align-items:center;gap:16px;padding:28px 20px;border-radius:12px;background:var(--el-fill-color-light);color:var(--el-text-color-secondary)}
.calendar-empty>.el-icon{font-size:26px;color:var(--el-color-primary);flex-shrink:0}
.calendar-empty strong{font-size:14px;font-weight:500;color:var(--el-text-color-regular)}
.calendar-empty p{font-size:12px;margin:4px 0 0}
@media(max-width:1100px){.calendar-marker-label{display:none}}
@media(max-width:760px){
 .planning-calendar :deep(.el-calendar__header){padding:8px 0 16px;gap:0}
 .calendar-toolbar{flex-wrap:wrap;gap:14px}
 .calendar-month-title{font-size:27px;gap:8px}
 .calendar-controls{width:100%;justify-content:space-between}
 .calendar-date-picker{height:38px;font-size:13px}
 .calendar-navigation .el-button{font-size:13px}
 .planning-calendar :deep(.el-calendar__body){padding:0;max-width:520px}
 .planning-calendar :deep(.el-calendar-table thead th){font-size:12px;padding:13px 0}
 .planning-calendar :deep(.el-calendar-table .el-calendar-day){height:auto;padding:2px}
 .calendar-day-content{padding:4px 2px;align-items:center;min-height:44px;justify-content:center}
 .calendar-day-top{justify-content:center}
 .calendar-day-number{font-size:14px;width:28px;height:28px}
 .calendar-today-label,.calendar-day-preview{display:none}
 .calendar-day-marks{gap:5px;flex-wrap:nowrap;justify-content:center;margin-top:4px;height:4px}
 .calendar-day-marks .calendar-marker-label,.calendar-day-marks .calendar-marker-count{display:none}
 .calendar-marker{gap:3px}
 .calendar-marker>i{width:4px;height:4px}
 .calendar-legend{gap:10px 16px;padding:12px 2px}
 .calendar-legend-note{width:100%;margin-left:0;font-size:11px}
 .planning-calendar .calendar-agenda{padding-top:14px;margin-top:4px}
 .calendar-agenda-header{margin-bottom:12px}
 .calendar-agenda-header h2{font-size:21px}
 .calendar-agenda-eyebrow{margin-bottom:2px}
 .calendar-plan-form{margin-bottom:6px;gap:8px}
 .calendar-plan-form .el-select{flex:1;width:0}
 .calendar-plan-form>.el-button{font-size:12px;padding:0 12px}
 .calendar-task-row{display:grid;grid-template-columns:minmax(0,1fr) auto;align-items:start;gap:4px 8px;padding:10px 0}
 .calendar-task-info{display:contents}
 .calendar-task-title{grid-column:1/-1;font-size:14px;line-height:1.45}
 .calendar-task-deadline{grid-column:1;align-self:center;font-size:11px;padding:2px 5px}
 .calendar-task-actions{grid-column:2;grid-row:2;gap:4px;align-self:center}
 .calendar-task-actions .el-tag{font-size:11px}
 .calendar-task-actions .el-button{font-size:12px;min-height:36px;padding:6px 4px;margin-left:0}
 .calendar-empty{padding:24px 14px;gap:12px}
}
@media(prefers-reduced-motion:reduce){.calendar-day-content{transition:none}}
</style>
