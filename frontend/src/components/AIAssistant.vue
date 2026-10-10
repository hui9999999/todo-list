<script setup lang="ts">
import {computed, nextTick, onMounted, onUnmounted, ref, watch} from 'vue';
import {ChatDotRound, Paperclip, Document, MoreFilled, Plus, Connection} from '@element-plus/icons-vue';
import {ElMessage, ElMessageBox, type InputInstance} from 'element-plus';
import {api, apiResponse, post} from '../api';
import {nativeApp} from '../platform';
import {useTasks, localDate} from '../stores/tasks';
import {useAuth} from '../stores/auth';
import type {Conversation, Message, Run, Proposal, HistoryHit, AssistantDownload, WebSource} from '../advanced-types';
import {saveFile} from '../save-file';
import '../assistant-data.css';
import ProposalCard from './ProposalCard.vue';
import {attachmentAccept, fileSize, useChatAttachments} from '../chat-attachments';
import {useDesktopPet} from '../stores/desktop-pet';
import AIUsageHelp from './AIUsageHelp.vue';
import {createUuid} from '../uuid';
import {restoreAssistantSession,rememberAssistantSession,restoreWebSearch,rememberWebSearch} from '../assistant-session';
import WebSources from './WebSources.vue';
const props=withDefaults(defineProps<{active?:boolean}>(),{active:true});
const desktop=useDesktopPet(),tasks=useTasks(),auth=useAuth();
const savedSession=restoreAssistantSession(auth.user?.id||'');
const conversations = ref<Conversation[]>([]), selected = ref((desktop.available?desktop.conversationId:'') || savedSession.conversationId), messages = ref<Message[]>([]);
const modelReady = ref(false);
const input = ref(savedSession.draft), liveAnswer = ref(''), followups = ref<string[]>([]), citations = ref<HistoryHit[]>([]);
watch([selected,input],([conversationId,draft])=>rememberAssistantSession(auth.user?.id||'',conversationId,draft),{flush:'sync'});
const run = ref<Run|null>(null), proposal = ref<Proposal|null>(null), busy = ref(false), error = ref(''), clarificationAnswer = ref('');
const downloading=ref(''),readingData=ref(false);
const webSearchEnabled=ref(restoreWebSearch(auth.user?.id||'')),searchingWeb=ref(false);
watch(webSearchEnabled,enabled=>rememberWebSearch(auth.user?.id||'',enabled),{flush:'sync'});
let stream: EventSource|null = null, cursor = 0;
let statusTimer: ReturnType<typeof setInterval>|undefined, checkingStatus = false, ticks = 0;
const now = ref(Date.now());
const displayedError = computed(() => error.value || run.value?.error || '');
const showStarters = computed(() => !messages.value.some(message => message.role === 'user') && !liveAnswer.value && !run.value);
const waitingSeconds = computed(() => run.value?.created_at ? Math.max(0, Math.floor((now.value - Date.parse(run.value.created_at))/1000)) : 0);
const chatScroller = ref<HTMLElement|null>(null);
const composerInput = ref<InputInstance|null>(null);
const fileInput = ref<HTMLInputElement|null>(null);
const conversationMenuOpen = ref(false), taskMenuOpen = ref(false), helpOpen = ref(false);
const starters = [
  {label: '安排今天', text: '帮我安排今天的事情'},
  {label: '拆分任务', text: '把一个大任务拆成小步骤'},
  {label: '查找类似事项', text: '找找以前做过的类似事情'},
];
const {files: attachments, reading: readingAttachments, error: attachmentError, clear: clearAttachments, remove: removeAttachment, add: addAttachments, paste: pasteAttachments, drop: dropAttachments} = useChatAttachments(() => busy.value || !!(run.value && ['pending','running','awaiting_confirmation','awaiting_clarification'].includes(run.value.status)));
async function chooseFiles(event: Event) {
  const element = event.target as HTMLInputElement;
  await addAttachments(Array.from(element.files || []));
  element.value = '';
}
const taskActions = [
  {label: '创建任务', text: '创建任务：任务名称'},
  {label: '修改任务', text: '将「任务名称」的优先级改为高'},
  {label: '删除任务', text: '删除任务「任务名称」'},
];
const requestPending = computed(() => readingAttachments.value || busy.value || !!(run.value && ['pending','running','awaiting_confirmation','awaiting_clarification'].includes(run.value.status)));
watch([selected,()=>run.value?.id,()=>run.value?.status,readingAttachments],()=>{
  if(!desktop.available)return;
  desktop.conversationId=selected.value;desktop.runId=run.value?.id||'';
  desktop.aiStatus=readingAttachments.value || (run.value && ['pending','running'].includes(run.value.status))?'thinking':run.value && ['awaiting_confirmation','awaiting_clarification'].includes(run.value.status)?'confirm':run.value?.status==='failed'?'error':'idle';
});
async function startTaskAction(text: string) {
  taskMenuOpen.value = false;
  input.value = text;
  await nextTick();
  composerInput.value?.focus();
  const start = text.indexOf('任务名称');
  composerInput.value?.textarea?.setSelectionRange(start, start + 4);
}
let followLatest = true;
watch(()=>props.active,async active=>{
  if(!active){conversationMenuOpen.value=false;taskMenuOpen.value=false;helpOpen.value=false;return;}
  await nextTick();
  if(followLatest && chatScroller.value)chatScroller.value.scrollTop=chatScroller.value.scrollHeight;
});
function trackScroll() {
  const el = chatScroller.value;
  if (el) followLatest = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
}
watch([messages, liveAnswer, proposal, () => run.value?.status], async () => {
  await nextTick();
  if (followLatest && chatScroller.value) chatScroller.value.scrollTop = chatScroller.value.scrollHeight;
}, {flush: 'post'});
function resetLive() {
  clearAttachments();
  stream?.close(); stream=null; cursor=0; liveAnswer.value=''; followups.value=[]; citations.value=[];readingData.value=false;searchingWeb.value=false;
  clarificationAnswer.value=''; followLatest=true;
}
async function refreshTasks() {await tasks.refresh(localDate(auth.user?.timezone || 'Asia/Shanghai'));}
async function load() {
  const [chats, preference] = await Promise.all([api<Conversation[]>('/conversations'), api<{model:string}|null>('/model-preferences')]);
  conversations.value = chats; modelReady.value = !!preference;
  if(selected.value && !chats.some(chat=>chat.id===selected.value)){
    resetLive();selected.value='';input.value='';messages.value=[];run.value=null;proposal.value=null;
  }
  if(!selected.value && chats.length)selected.value=chats[0]!.id;
  if (selected.value) {
    const identifier=selected.value;
    const data = await api<{messages: Message[]; runs: Run[]; downloads?:AssistantDownload[];web_sources?:{message_id:string;sources:WebSource[]}[]}>('/conversations/'+identifier+'/messages');
    const last = data.runs.at(-1);
    const latest = last ? await api<Run>('/agent-runs/'+last.id) : null;
    if(selected.value!==identifier)return;
    messages.value = data.messages.map(message=>({...message,downloads:(data.downloads||[]).filter(card=>card.message_id===message.id),web_sources:(data.web_sources||[]).filter(group=>group.message_id===message.id).flatMap(group=>group.sources)}));
    run.value = latest;
    searchingWeb.value=latest?.web_search?.state==='searching' && ['pending','running'].includes(latest.status);
    proposal.value = run.value?.proposals?.at(-1) || null;
  }
}
async function choose() {
  conversationMenuOpen.value = false;
  resetLive(); error.value='';
  await act(async () => {await load(); if (run.value && ['pending','running'].includes(run.value.status)) subscribe();});
}
async function act(fn: () => Promise<void>) {
  busy.value=true; error.value='';
  try {await fn();} catch(e) {error.value=(e as Error).message;} finally {busy.value=false;}
}
async function newChat() {
  conversationMenuOpen.value = false;
  await act(async () => {const chat=await post<Conversation>('/conversations'); resetLive(); selected.value=chat.id; input.value=''; run.value=null; proposal.value=null; messages.value=[]; await load();});
}
async function send(text=input.value) {
  if ((!text.trim() && !attachments.value.length) || requestPending.value) return;
  await act(async () => {
    followLatest=true;
    if (!selected.value) selected.value=(await post<Conversation>('/conversations')).id;
    run.value=await post<Run>('/conversations/'+selected.value+'/messages', {content: text.trim() ? text : '请阅读这些附件。', idempotency_key: createUuid(), attachments: attachments.value.map(({name, data}) => ({name, data})),web_search_enabled:webSearchEnabled.value});
    clearAttachments();
    input.value=''; liveAnswer.value=''; followups.value=[]; citations.value=[]; proposal.value=null; cursor=0;searchingWeb.value=false;
    await load(); subscribe();
  });
}
function messageKeydown(event: Event) {
  if (!(event instanceof KeyboardEvent)) return;
  if (event.key !== 'Enter' || event.shiftKey || event.ctrlKey || event.altKey || event.metaKey
      || event.isComposing || event.keyCode === 229) return;
  event.preventDefault();
  if (!event.repeat) void send();
}
function subscribe() {
  stream?.close(); if (!run.value) return;
  // WebView EventSource cannot share the native HTTP cookie store across origins.
  if (nativeApp) { void checkRunStatus(); return; }
  const source = new EventSource('/api/v1/agent-runs/'+run.value.id+'/events?after='+cursor);
  stream=source;
  for (const kind of ['status','answer_delta','clarification','proposal','followups','citations','tool_result','web_search','web_sources','error','done']) {
    source.addEventListener(kind, event => {
      if (source !== stream) return;
      const msg = event as MessageEvent;
      if (!msg.data) return;
      // One malformed frame must not throw inside the listener and kill the stream.
      let data: any;
      try { data = JSON.parse(msg.data); } catch { return; }
      cursor=Math.max(cursor, Number(msg.lastEventId)||0);
      if (kind==='answer_delta') {readingData.value=false;liveAnswer.value += data.text;}
      if (kind==='tool_result' && data.kind==='read_data') {liveAnswer.value='';readingData.value=true;}
      if (kind==='web_search') {searchingWeb.value=data.state==='searching';if(searchingWeb.value){liveAnswer.value='';readingData.value=false;}}
      if (kind==='status' && run.value) {run.value.status=data.status; run.value.actual_mode=data.actual_mode; run.value.mode_reason=data.reason;}
      if (kind==='clarification' && run.value) {run.value.clarification=data; run.value.status='awaiting_clarification';}
      if (kind==='proposal') proposal.value=data;
      if (kind==='followups') followups.value=data.questions;
      if (kind==='citations') citations.value=data.sources;
      if (kind==='error') {source.close(); void load().catch(()=>{}); error.value=data.message;}
      if (kind==='done') {source.close();readingData.value=false;searchingWeb.value=false; if(run.value) run.value.status=data.status; void act(async () => {await load(); liveAnswer.value='';});}
    });
  }
}
// Native WebView has no cross-origin EventSource; polling applies the same event
// frames so partial answers stream in while the run is still executing.
function applyEventFrames(frames: string) {
  for (const frame of frames.split(/\r?\n\r?\n/)) {
    const kind = frame.match(/^event: (.+)$/m)?.[1];
    const payload = frame.match(/^data: (.+)$/m)?.[1];
    if (!payload) continue;
    try {
      const data = JSON.parse(payload);
      cursor = Math.max(cursor, Number(frame.match(/^id: (\d+)$/m)?.[1]) || 0);
      if (kind === 'answer_delta') {readingData.value=false;liveAnswer.value += data.text;}
      if (kind === 'tool_result' && data.kind==='read_data') {liveAnswer.value='';readingData.value=true;}
      if (kind === 'web_search') {searchingWeb.value=data.state==='searching';if(searchingWeb.value){liveAnswer.value='';readingData.value=false;}}
      if (kind === 'followups') followups.value = data.questions;
      if (kind === 'citations') citations.value = data.sources;
    } catch { /* Skip a malformed frame; the status endpoint remains authoritative. */ }
  }
}
async function fetchNewEvents(id: string) {
  const response = await apiResponse('/agent-runs/'+id+'/events?after='+cursor);
  if (response.ok && run.value?.id === id) applyEventFrames(await response.text());
}
async function checkRunStatus() {
  if (checkingStatus || !run.value || !['pending','running'].includes(run.value.status)) return;
  const id = run.value.id;
  checkingStatus = true;
  try {
    // Recover the terminal state even if the browser misses the final SSE event.
    const latest = await api<Run>('/agent-runs/'+id);
    if (run.value?.id !== id) return;
    searchingWeb.value=latest.web_search?.state==='searching' && ['pending','running'].includes(latest.status);
    if (!['pending','running'].includes(latest.status)) {
      stream?.close(); stream=null;
      run.value=latest; proposal.value=latest.proposals?.at(-1) || null;
      if (nativeApp) {
        try { await fetchNewEvents(id); } catch { /* The answer and proposal remain available from the status endpoint. */ }
      }
      await load(); liveAnswer.value='';
    } else if (nativeApp) {
      try { await fetchNewEvents(id); } catch { /* Retry on the next tick. */ }
    }
  } catch { /* EventSource reconnects; the next status check retries. */ }
  finally {checkingStatus=false;}
}
async function clarify(answer=clarificationAnswer.value) {
  if (!run.value || !answer.trim()) return;
  await act(async () => {run.value=await post<Run>('/agent-runs/'+run.value!.id+'/clarifications',{answer}); clarificationAnswer.value=''; liveAnswer.value=''; subscribe();});
}
async function cancel() {
  if (!run.value) return;
  await act(async () => {await post('/agent-runs/'+run.value!.id+'/cancel'); stream?.close(); await load();});
}
async function proposalAction(action: string) {
  if (!proposal.value) return;
  await act(async () => {
    const p=proposal.value!;
    await post(action==='undo'? '/actions/'+p.id+'/undo' : '/action-proposals/'+p.id+'/'+action, action==='confirm'? {version:p.version}:{});
    await load(); await refreshTasks(); ElMessage.success(action==='undo'?'操作已撤销':'提案已处理');
  });
}
async function deleteChat() {
  if (!selected.value) return;
  conversationMenuOpen.value = false;
  try {await ElMessageBox.confirm('删除本段对话及由其派生的记忆？','删除对话',{type:'warning'});} catch {return;}
  await act(async () => {await api('/conversations/'+selected.value,{method:'DELETE'}); resetLive(); selected.value=''; input.value=''; messages.value=[]; run.value=null; proposal.value=null; await load();});
}
async function downloadCard(card:AssistantDownload){
  if(downloading.value)return;
  downloading.value=card.id;
  try{
    const response=await apiResponse('/assistant/exports/'+encodeURIComponent(card.id),{},true);
    if(!response.ok){const body=await response.json().catch(()=>({}));throw new Error(typeof body.detail==='string'?body.detail:'文件导出失败，请重试');}
    await saveFile(await response.blob(),card.filename);
    ElMessage.success(nativeApp?'导出文件已准备分享':'导出文件已生成');
  }catch(e){ElMessage.error((e as Error).message);}
  finally{downloading.value='';}
}
onMounted(() => {
  void act(async()=>{await load();if(run.value && ['pending','running'].includes(run.value.status))subscribe();});
  statusTimer=setInterval(() => {now.value=Date.now(); if (++ticks % (nativeApp ? 2 : 5) === 0) void checkRunStatus();}, 1000);
});
onUnmounted(() => {stream?.close(); clearInterval(statusTimer);});
</script>
<template>
  <section class="feature-page ai-page" aria-label="小狒 AI 助手" @dragover.prevent @drop="dropAttachments">
    <header class="ai-header">
      <div class="ai-identity"><span class="ai-avatar" aria-hidden="true"><el-icon><ChatDotRound/></el-icon></span><div><h1>小狒 <span>AI 助手</span></h1></div></div>
      <div class="ai-header-actions">
        <div class="ai-conversation-tools ai-desktop-only"><el-select v-model="selected" placeholder="历史对话" aria-label="历史对话" @change="choose"><el-option v-for="c in conversations" :key="c.id" :value="c.id" :label="c.title"/></el-select></div>
        <el-button @click="newChat" :disabled="busy">新对话</el-button>
        <el-button v-if="selected" class="ai-desktop-only" text @click="deleteChat" :disabled="busy">删除对话</el-button>
        <el-popover v-model:visible="conversationMenuOpen" trigger="click" role="dialog" title="对话操作" placement="bottom-end" :width="288" popper-class="ai-mobile-menu">
          <template #reference><el-button class="ai-mobile-only ai-icon-button" :icon="MoreFilled" aria-label="更多对话操作" :aria-expanded="conversationMenuOpen"/></template>
          <div class="ai-menu-content">
            <label class="ai-menu-label">切换历史对话</label>
            <el-select v-model="selected" placeholder="历史对话" aria-label="历史对话" @change="choose"><el-option v-for="c in conversations" :key="c.id" :value="c.id" :label="c.title"/></el-select>
            <el-button v-if="selected" text type="danger" @click="deleteChat" :disabled="busy">删除对话</el-button>
          </div>
        </el-popover>
      </div>
    </header>
    <div ref="chatScroller" class="ai-chat-scroll" @scroll="trackScroll">
      <div class="ai-chat-content">
        <el-alert v-if="displayedError" :title="displayedError" type="error" :closable="false" show-icon/>
        <div v-if="!messages.length && !liveAnswer && !run" class="ai-welcome">
          <div class="ai-starters ai-desktop-only"><button v-for="example in starters" :key="example.text" type="button" @click="input=example.text"><span class="ai-starter-desktop">{{ example.text }}</span><span class="ai-starter-mobile">{{ example.label }}</span><span class="ai-starter-arrow" aria-hidden="true">↗</span></button></div>
          <router-link v-if="!modelReady" class="ai-setup-link" to="/account?tab=model">连接对话模型 →</router-link>
        </div>
        <div class="message-list" aria-live="polite" aria-relevant="additions text">
          <article v-for="m in messages" :key="m.id" class="chat-message" :class="m.role"><small>{{ m.role==='user'?'我':'小狒' }}</small><p>{{ m.content }}</p><ul v-if="m.attachments?.length" class="ai-message-files" aria-label="消息附件"><li v-for="(file, index) in m.attachments" :key="index"><div><el-icon><Document/></el-icon><strong>{{ file.name }}</strong><span>{{ fileSize(file.size) }}{{ file.pages ? ' · '+file.pages+' 页' : '' }}</span></div><p v-for="warning in file.warnings" :key="warning" class="ai-file-warning">{{ warning }}</p></li></ul><section v-for="card in m.downloads" :key="card.id" class="ai-download-card" :aria-label="card.label+'导出文件'"><div><el-icon><Document/></el-icon><strong>{{card.label}}</strong><span>{{card.format.toUpperCase()}}</span></div><p>{{card.description}}</p><el-button :loading="downloading===card.id" :disabled="!!downloading && downloading!==card.id" @click="downloadCard(card)">{{nativeApp?'保存或分享':'下载文件'}}</el-button></section><WebSources v-if="m.web_sources?.length" :sources="m.web_sources"/></article>
          <article v-if="liveAnswer" class="chat-message assistant"><small>小狒 · 正在回答</small><p>{{ liveAnswer }}</p></article>
        </div>
        <div v-if="messages.length && showStarters" class="ai-starters ai-desktop-only ai-greeting-starters" role="group" aria-label="对话建议"><button v-for="example in starters" :key="example.text" type="button" @click="input=example.text; composerInput?.focus()">{{example.label}}</button></div>
        <router-link v-if="messages.length && showStarters && !modelReady" class="ai-setup-link" to="/account?tab=model">连接对话模型 →</router-link>
        <p v-if="run && ['pending','running'].includes(run.status)" class="ai-run-status" role="status">{{ run.status==='pending' ? '请求已提交，等待处理…' : searchingWeb ? '正在联网搜索…' : readingData ? '正在查询并整理你的资料…' : liveAnswer ? '小狒正在回复…' : '正在等待模型回复…' }}<span v-if="waitingSeconds"> 已等待 {{ waitingSeconds }} 秒。</span><span v-if="run.status==='running'"> 模型响应最长等待 3 分钟，可随时取消。</span></p>
        <section v-if="run?.status==='awaiting_clarification' && run.clarification" class="proposal-card"><h3>{{ run.clarification.question }}</h3><div class="action-row"><el-button v-for="option in run.clarification.options" :key="option" :disabled="busy" @click="clarify(option)">{{ option }}</el-button></div><form class="action-row" @submit.prevent="clarify()"><el-input v-model="clarificationAnswer" aria-label="补充澄清" placeholder="或直接补充"/><el-button native-type="submit" :disabled="busy">继续</el-button></form></section>
        <ProposalCard v-if="proposal" :proposal="proposal" :busy="busy" @confirm="proposalAction('confirm')" @reject="proposalAction('reject')" @undo="proposalAction('undo')"/>
        <details class="citation-list" v-if="citations.length"><summary>参考记录（{{citations.length}}）</summary><router-link v-for="c in citations" :key="c.event_id" :to="'/history?task='+c.task_id">{{ c.title }} · {{ c.completed?'完成记录':'历史记录' }} · {{ c.occurred_at.slice(0,10) }}</router-link></details>
        <div class="action-row" v-if="run?.status==='completed'"><el-button v-for="q in followups" :key="q" :disabled="busy" @click="send(q)">{{ q }}</el-button></div>
      </div>
    </div>
    <footer class="ai-composer">
      <div v-if="showStarters" class="ai-starters ai-composer-starters ai-mobile-only" role="group" aria-label="对话建议"><button v-for="example in starters" :key="example.text" type="button" @click="input=example.text; composerInput?.focus()">{{example.label}}</button></div>
      <div class="ai-task-actions ai-desktop-only" role="group" aria-label="AI 任务操作"><span>管理任务</span><button v-for="action in taskActions" :key="action.label" type="button" :disabled="requestPending" @click="startTaskAction(action.text)">{{ action.label }}</button></div>
      <el-alert v-if="attachmentError" :title="attachmentError" type="error" :closable="false" show-icon class="ai-attachment-error"/>
      <input id="chat-attachments" ref="fileInput" type="file" multiple :accept="attachmentAccept" hidden aria-label="选择聊天附件" @change="chooseFiles"/>
      <form class="chat-input" @submit.prevent="send()" @paste="pasteAttachments">
        <ul v-if="attachments.length" class="ai-draft-files" aria-label="待发送附件"><li v-for="file in attachments" :key="file.id"><img v-if="file.preview" :src="file.preview" alt="待发送图片预览"/><el-icon v-else><Document/></el-icon><span><strong>{{ file.name }}</strong><small>{{ fileSize(file.size) }}</small></span><button type="button" :aria-label="'移除附件 '+file.name" :disabled="requestPending" @click="removeAttachment(file.id)">×</button></li></ul>
        <el-input ref="composerInput" v-model="input" type="textarea" :rows="2" maxlength="10000" placeholder="例如：创建任务买牛奶，或把汇报任务改为高优先级…" aria-label="发给 AI 的消息" @keydown="messageKeydown"/>
        <div class="ai-composer-actions">
          <el-popover v-model:visible="taskMenuOpen" trigger="click" role="dialog" title="任务与帮助" placement="top-start" :width="264" popper-class="ai-mobile-menu">
            <template #reference><el-button class="ai-mobile-only ai-icon-button" text :icon="Plus" aria-label="任务快捷操作" :aria-expanded="taskMenuOpen"/></template>
            <div class="ai-menu-content"><span class="ai-menu-label">管理任务</span><el-button v-for="action in taskActions" :key="action.label" text :disabled="requestPending" @click="startTaskAction(action.text)">{{ action.label }}</el-button><el-button text @click="taskMenuOpen=false; helpOpen=true">使用说明</el-button></div>
          </el-popover>
          <el-button class="ai-attach-button" text :icon="Paperclip" aria-label="添加附件" :disabled="requestPending" @click="fileInput?.click()"><span class="ai-attach-label">添加附件</span></el-button><el-button class="ai-web-toggle" :class="{'is-on':webSearchEnabled}" text :icon="Connection" aria-label="联网搜索" :aria-pressed="webSearchEnabled" :disabled="requestPending" @click="webSearchEnabled=!webSearchEnabled"><span class="ai-web-label-desktop">联网搜索</span><span class="ai-web-label-mobile">联网</span></el-button><span class="ai-keyboard-hint">Enter 发送 · Shift + Enter 换行</span><div><el-button v-if="run && ['pending','running','awaiting_confirmation','awaiting_clarification'].includes(run.status)" @click="cancel" :disabled="busy"><span class="ai-desktop-only">取消当前请求</span><span class="ai-mobile-only">取消</span></el-button><el-button type="primary" native-type="submit" :loading="busy && !!attachments.length" :disabled="requestPending || (!input.trim() && !attachments.length)">发送</el-button></div>
        </div>
      </form>
      <p class="ai-file-hint" :class="{'is-active': readingAttachments || busy && attachments.length}" role="status">{{ readingAttachments ? '正在读取附件…' : busy && attachments.length ? '正在解析附件，图片和扫描 PDF 可能需要稍等…' : 'Word（DOCX）、PDF、MD、JSON、TXT、CSV、图片 · 支持拖入和粘贴截图' }}</p>
      <details class="ai-context-note ai-desktop-only"><summary>使用说明</summary><AIUsageHelp :run="run"/></details>
    </footer>
    <el-dialog v-model="helpOpen" title="使用说明" class="ai-help-dialog"><AIUsageHelp :run="run"/></el-dialog>
  </section>
</template>
