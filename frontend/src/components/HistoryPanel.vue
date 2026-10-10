<script setup lang="ts">
import {computed, onMounted, ref, watch} from 'vue';
import {useRoute} from 'vue-router';
import {ElMessageBox} from 'element-plus';
import {api,post} from '../api';
import type {HistoryHit,Memory} from '../advanced-types';
import RecordPagination from './RecordPagination.vue';
const route=useRoute();
const query=ref(''), start=ref(''),end=ref(''),scope=ref('all'),semantic=ref(true),status=ref(''),busy=ref(false),error=ref('');
const searchInfo=ref('');
const scopeLabels:Record<string,string>={all:'全部',work:'工作',life:'生活',study:'学习',unassigned:'未分类'};
const stateLabels:Record<string,string>={active:'使用中',fading:'逐渐减弱',candidate:'待确认',dormant:'暂不使用',expired:'已过期',superseded:'已替代',revoked:'已撤销'};
const sourceLabels:Record<string,string>={explicit:'你填写的',confirmed:'你确认的',inferred:'小狒建议的'};
const eventLabels:Record<string,string>={created:'创建任务',updated:'修改任务',status_changed:'更改状态',trashed:'移入垃圾站',restored:'恢复任务',imported:'导入任务',imported_completion:'导入完成记录',dependency_changed:'更改前置任务'};
const taskStatusLabels:Record<string,string>={todo:'待办',doing:'进行中',done:'已完成',failed:'失败',cancelled:'已取消'};
const hits=ref<HistoryHit[]>([]),memories=ref<Memory[]>([]),events=ref<{id:string;kind:string;occurred_at:string;after:{title:string;notes:string;status:string}}[]>([]);
const form=ref({content:'',key:'',scope:'all',kind:'preference',pinned:false,valid_to:''});
const adding=ref(false);
const view=ref<'history'|'memory'>('history'),memoryQuery=ref(''),memoryState=ref('all');
const pageSize=10;
const historyPage=ref(1),historyTotal=ref(0),memoryPage=ref(1),eventsPage=ref(1);
const filteredMemories=computed(()=>memories.value.filter(memory=>{
  const keyword=memoryQuery.value.trim().toLocaleLowerCase();
  const active=['active','fading'].includes(memory.effective_state);
  const stateMatches=memoryState.value==='all' || (memoryState.value==='active'?active:memoryState.value==='candidate'?memory.effective_state==='candidate':!active && memory.effective_state!=='candidate');
  return stateMatches && (!keyword || `${memory.content} ${memory.key || ''}`.toLocaleLowerCase().includes(keyword));
}));
const pagedMemories=computed(()=>filteredMemories.value.slice((memoryPage.value-1)*pageSize,memoryPage.value*pageSize));
const pagedEvents=computed(()=>events.value.slice((eventsPage.value-1)*pageSize,eventsPage.value*pageSize));
watch([memoryQuery,memoryState],()=>{memoryPage.value=1;});
watch(filteredMemories,rows=>{memoryPage.value=Math.min(memoryPage.value,Math.max(1,Math.ceil(rows.length/pageSize)));});
const kindLabels:Record<string,string>={preference:'偏好',goal:'长期目标',constraint:'临时约束',interest:'兴趣'};
const chinaTime=new Intl.DateTimeFormat('zh-CN',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'});
function displayTime(value:string){
  const date=new Date(value);
  if(!Number.isFinite(date.getTime()))return '时间未知';
  const parts=Object.fromEntries(chinaTime.formatToParts(date).map(part=>[part.type,part.value]));
  return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}:${parts.second}（中国标准时间）`;
}
async function act(fn:()=>Promise<void>){busy.value=true;error.value='';try{await fn();}catch(e){error.value=(e as Error).message;}finally{busy.value=false;}}
let submittedSearch=new URLSearchParams();
async function search(page=1,resetFilters=true){
  await act(async()=>{
    const params=resetFilters ? new URLSearchParams({q:query.value,scope:scope.value,semantic:String(semantic.value)}) : new URLSearchParams(submittedSearch);
    if(resetFilters){
      if(start.value)params.set('start',new Date(start.value).toISOString());
      if(end.value)params.set('end',new Date(end.value).toISOString());
    }
    params.set('page',String(page));params.set('page_size',String(pageSize));
    const result=await api<{hits:HistoryHit[];total?:number;mode:string;index_status:string;message:string}>('/history/search?'+params);
    hits.value=result.hits;historyTotal.value=result.total ?? result.hits.length;historyPage.value=page;submittedSearch=params;
    status.value=historyTotal.value?'找到 '+historyTotal.value+' 条记录':'暂无匹配记录';searchInfo.value=result.message;
  });
}
async function loadEvents(taskId:string){events.value=await api('/tasks/'+encodeURIComponent(taskId)+'/events');eventsPage.value=1;}
async function load(){memories.value=await api('/memories'); if(route.query.task)await loadEvents(String(route.query.task));}
async function add(){await act(async()=>{await post('/memories',{...form.value,key:form.value.key || form.value.content.slice(0,100),valid_to:form.value.valid_to?new Date(form.value.valid_to).toISOString():null});form.value.content='';form.value.key='';adding.value=false;memoryQuery.value='';memoryState.value='all';memoryPage.value=1;await load();});}
async function forget(m:Memory){try{await ElMessageBox.confirm('停止使用并删除这条记忆及相关派生内容？任务历史仍保留。','遗忘记忆',{type:'warning'});}catch{return;}await act(async()=>{await post('/memories/'+m.id+'/forget');await load();});}
async function pin(m:Memory){await act(async()=>{await post('/memories/'+m.id+'/pin',{version:m.version});await load();});}
onMounted(()=>act(async()=>{await load();await search();}));
</script>
<template>
<section class="feature-page history-page">
  <header class="history-page-heading"><h2>历史与记忆</h2></header>
  <nav class="history-view-nav" aria-label="历史与记忆分区"><button type="button" :class="{active:view==='history'}" :aria-pressed="view==='history'" aria-label="任务历史" @click="view='history'">任务历史 <span aria-hidden="true">{{historyTotal}}</span></button><button type="button" :class="{active:view==='memory'}" :aria-pressed="view==='memory'" aria-label="记忆" @click="view='memory'">记忆 <span aria-hidden="true">{{memories.length}}</span></button></nav>
  <el-alert v-if="error" :title="error" type="error" :closable="false"/>
  <section v-show="view==='history'" class="feature-section history-search" aria-labelledby="history-search-heading">
    <header class="history-section-header"><div><h2 id="history-search-heading">查找历史</h2><p>找回做过的事情与当时的记录</p></div></header>
    <form @submit.prevent="search()">
      <div class="history-query-row"><el-input v-model="query" clearable placeholder="搜索做过的事情" aria-label="历史关键词"/><el-select v-model="scope" aria-label="历史范围"><el-option label="全部范围" value="all"/><el-option label="工作" value="work"/><el-option label="生活" value="life"/><el-option label="学习" value="study"/><el-option label="未分类" value="unassigned"/></el-select><el-button type="primary" native-type="submit" :loading="busy" :disabled="busy">查找历史</el-button></div>
      <div class="history-search-options"><el-checkbox v-model="semantic">按意思查找相似记录</el-checkbox><details class="help-disclosure history-date-filter"><summary>筛选时间</summary><div class="form-grid"><label>开始时间<input v-model="start" type="datetime-local" aria-label="历史开始时间"/></label><label>结束时间（不含）<input v-model="end" type="datetime-local" aria-label="历史结束时间"/></label></div></details></div>
    </form>
    <div class="history-result-status"><p v-if="status" class="field-hint" role="status">{{status}}</p><span>中国标准时间</span></div>
    <details v-if="searchInfo" class="help-disclosure"><summary>搜索说明</summary><p>{{searchInfo}}</p></details>
    <p v-if="status && !hits.length && !busy" class="history-empty">试试其他关键词，或放宽范围和时间筛选。</p>
    <article v-for="hit in hits" :key="hit.event_id" class="evidence-row history-record">
      <div class="history-record-heading"><h3>{{hit.title}}</h3><el-tag size="small" :type="hit.completed?'success':'info'">{{hit.completed?'当时已完成':'历史记录'}}</el-tag></div>
      <time class="evidence-time" :datetime="hit.occurred_at">{{displayTime(hit.occurred_at).replace('（中国标准时间）','')}}</time>
      <p v-if="hit.snapshot.notes" class="history-note">{{hit.snapshot.notes.length>100?hit.snapshot.notes.slice(0,100)+'…':hit.snapshot.notes}}</p>
      <details class="help-disclosure"><summary>记录详情</summary><p v-if="hit.snapshot.notes.length>100" class="history-note">{{hit.snapshot.notes}}</p><p>{{hit.reason}}</p><el-button text :disabled="busy" @click="act(()=>loadEvents(hit.task_id))">查看原始记录</el-button></details>
    </article>
    <RecordPagination :page="historyPage" :total="historyTotal" :page-size="pageSize" label="任务历史分页" :disabled="busy" @change="search($event,false)"/>
    <details v-if="events.length" open class="history-events"><summary>原始事件记录</summary><article v-for="e in pagedEvents" :key="e.id" class="evidence-row"><strong>{{e.after.title}}</strong><p class="muted">{{eventLabels[e.kind] || e.kind}} · {{displayTime(e.occurred_at)}} · {{taskStatusLabels[e.after.status] || e.after.status}}</p><p>{{e.after.notes}}</p></article><RecordPagination :page="eventsPage" :total="events.length" :page-size="pageSize" label="原始事件分页" :disabled="busy" @change="eventsPage=$event"/></details>
  </section>
  <section v-show="view==='memory'" class="feature-section memory-section" aria-labelledby="memory-heading">
    <header class="history-section-header"><div><h2 id="memory-heading">记忆管理</h2><p>小狒记住的偏好、兴趣与目标</p></div><el-button :aria-expanded="adding" aria-controls="memory-add-form" :disabled="busy" @click="adding=!adding">{{adding?'收起':'新增记忆'}}</el-button></header>
    <form v-show="adding" id="memory-add-form" class="memory-add-form" @submit.prevent="add"><div class="form-grid">
      <label class="memory-content-field">记住什么<el-input v-model="form.content" type="textarea" :autosize="{minRows:2,maxRows:5}" aria-label="记忆内容" maxlength="2000" placeholder="例如：下午集中处理工作"/></label>
      <label>范围<el-select v-model="form.scope" aria-label="记忆范围"><el-option label="全部" value="all"/><el-option label="工作" value="work"/><el-option label="生活" value="life"/><el-option label="学习" value="study"/></el-select></label>
      <label>类型<el-select v-model="form.kind" aria-label="记忆类型"><el-option label="偏好" value="preference"/><el-option label="长期目标" value="goal"/><el-option label="临时约束" value="constraint"/><el-option label="兴趣" value="interest"/></el-select></label>
    </div><details class="help-disclosure memory-add-options"><summary>更多选项</summary><div class="form-grid"><label>规则名称<el-input v-model="form.key" aria-label="记忆规则名称" maxlength="100" placeholder="可留空，同名规则用于更新偏好"/></label><label>有效至（可留空）<input type="datetime-local" v-model="form.valid_to" aria-label="记忆有效至"/></label><el-checkbox v-model="form.pinned">固定记忆</el-checkbox></div></details><el-button type="primary" native-type="submit" :loading="busy" :disabled="busy || !form.content.trim()">保存记忆</el-button></form>
    <div class="memory-filters"><el-input v-model="memoryQuery" clearable aria-label="记忆关键词" placeholder="搜索记忆内容或规则名称"/><el-select v-model="memoryState" aria-label="记忆状态"><el-option label="全部状态" value="all"/><el-option label="使用中" value="active"/><el-option label="待确认" value="candidate"/><el-option label="暂不使用" value="inactive"/></el-select></div>
    <p class="memory-result-count" role="status">显示 {{filteredMemories.length}} / {{memories.length}} 条记忆</p>
    <details class="help-disclosure"><summary>记忆使用规则</summary><p>固定偏好不会自然衰减；临时约束到期失效。模型推断仅为候选，确认后才用于安排。</p></details>
    <article v-for="m in pagedMemories" :key="m.id" class="evidence-row memory-record">
      <div class="memory-meta"><span>{{kindLabels[m.kind] || m.kind}} · {{scopeLabels[m.scope] || m.scope}}</span><span class="memory-state" :class="{'is-active':m.effective_state==='active'}">{{stateLabels[m.effective_state] || m.effective_state}}</span><span v-if="m.pinned" class="memory-pinned">已固定</span></div>
      <h3 class="memory-content">{{m.content}}</h3>
      <p v-if="m.valid_to" class="memory-expiry">有效至 {{displayTime(m.valid_to).replace('（中国标准时间）','')}}</p>
      <div class="memory-record-footer"><details class="help-disclosure"><summary>记忆详情</summary><p>{{sourceLabels[m.source_kind] || m.source_kind}} · 强度 {{Math.round(m.effective_strength*100)}}%</p><p v-if="m.key">规则名称：{{m.key}}</p></details><div class="memory-actions"><el-button text :disabled="busy || ['superseded','expired'].includes(m.effective_state)" @click="pin(m)">{{m.effective_state==='candidate'?'确认候选':m.pinned?'取消固定':'固定'}}</el-button><el-button :disabled="busy" text type="danger" @click="forget(m)">忘掉这条</el-button></div></div>
    </article>
    <p v-if="!memories.length" class="muted">还没有保存的记忆。</p>
    <p v-else-if="!filteredMemories.length" class="history-empty">没有匹配的记忆，试试其他关键词或状态。</p>
    <RecordPagination :page="memoryPage" :total="filteredMemories.length" :page-size="pageSize" label="记忆分页" :disabled="busy" @change="memoryPage=$event"/>
  </section>
</section>
</template>
<style scoped src="../history-layout.css"></style>
