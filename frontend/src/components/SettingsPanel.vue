<script setup lang="ts">
import {computed, onMounted, onUnmounted, ref, watch} from 'vue';
import {Bell} from '@element-plus/icons-vue';
import {ElMessage, ElMessageBox} from 'element-plus';
import {api, post} from '../api';
import {useAuth} from '../stores/auth';
import {useTasks} from '../stores/tasks';
import {useRoute, useRouter} from 'vue-router';
import type {Settings, Connection, Preference, Usage, Job} from '../advanced-types';
import {applyTheme,settingKeys} from '../themes';
import type {AccountProfile} from '../types';
import {weatherCityGroups} from '../weather-cities';
import DesktopPetSettings from './DesktopPetSettings.vue';
import JobRunChart from './JobRunChart.vue';
import HistoryPanel from './HistoryPanel.vue';
const props=defineProps<{appearance?:Settings|null}>();
const auth=useAuth();
const nicknameEditing=ref(false), nicknameDraft=ref(''), nicknameBusy=ref(false), nicknameError=ref(''), nicknameRemaining=ref<number|null>(null);
async function refreshProfile(){const profile=await api<AccountProfile>('/account-profile');auth.user=profile.user;nicknameRemaining.value=profile.nickname_changes_remaining;return profile;}
async function editNickname(){
  nicknameEditing.value=true;nicknameDraft.value=auth.user?.nickname || '';nicknameError.value='';nicknameBusy.value=true;
  try{await refreshProfile();nicknameDraft.value=auth.user?.nickname || '';}
  catch(e){nicknameError.value=(e as Error).message;nicknameRemaining.value=null;}
  finally{nicknameBusy.value=false;}
}
async function saveNickname(){
  const nickname=nicknameDraft.value.trim();
  if(!nickname){nicknameError.value='请输入昵称';return;}
  if(nicknameBusy.value)return;
  nicknameBusy.value=true;nicknameError.value='';
  try{
    const profile=await api<AccountProfile>('/account-profile',{method:'PUT',body:JSON.stringify({nickname})});
    auth.user=profile.user;nicknameRemaining.value=profile.nickname_changes_remaining;nicknameEditing.value=false;ElMessage.success('昵称已保存');
  }catch(e){nicknameError.value=(e as Error).message;await refreshProfile().catch(()=>{});}
  finally{nicknameBusy.value=false;}
}
const emit=defineEmits<{saved:[settings:Settings];'notification-preview':[]}>();
const notificationPermission=ref<NotificationPermission|'unsupported'>('unsupported'), permissionBusy=ref(false), permissionError=ref('');
function readNotificationPermission(){notificationPermission.value='Notification' in window ? Notification.permission : 'unsupported';}
const permissionTitle=computed(()=>({granted:'系统通知已开启',default:'系统通知尚未授权',denied:'系统通知被浏览器阻止',unsupported:'当前浏览器使用应用内提醒'})[notificationPermission.value]);
const permissionHelp=computed(()=>notificationPermission.value==='denied'?'可在地址栏的网站设置中允许通知，应用内提醒仍然可用。':notificationPermission.value==='granted'?'任务到期时显示提醒，点击即可查看任务。':'应用内提醒可以直接使用；授权后也会显示系统通知。');
const router=useRouter(),route=useRoute(),tasks=useTasks();
const sections=[{id:'preferences',label:'偏好设置'},{id:'history',label:'历史与记忆'},{id:'model',label:'AI 模型'},{id:'usage',label:'用量与运行'},{id:'security',label:'账户安全'}];
const tab=computed(()=>sections.some(s=>s.id===route.query.tab)?String(route.query.tab):'preferences');
const replaceKey=ref(false),auxiliaryError=ref('');
const jobsLoaded=ref(false),jobsError=ref(false);
async function logout(){await act(async()=>{await auth.logout();tasks.clear();await router.replace('/auth');});}
const form=ref<Settings|null>(null), connections=ref<Connection[]>([]), usage=ref<Usage|null>(null), jobs=ref<Job[]>([]);
const busy=ref(false), error=ref(''), models=ref<{id:string;name:string}[]>([]), modelStatus=ref('');
const newConnection=ref({name:'',provider:'deepseek',region:'cn',api_key:'',workspace_id:''});
const modelForm=ref<Preference>({connection_id:'',model:'',thinking:'auto'});
const currentModel=ref<Preference|null>(null), setupStage=ref(''), modelError=ref('');
const selectedConnection=computed(()=>connections.value.find(c=>c.enabled && c.id===modelForm.value.connection_id));
const modelOptions=computed(()=>{
  const cached=selectedConnection.value?.models || [];
  const options=[...cached.filter(m=>!m.purpose || m.purpose==='chat'),...models.value];
  const verified=Object.entries(selectedConnection.value?.capabilities || {}).filter(([,cap])=>cap.chat).map(([id])=>({id,name:id}));
  return [...new Map([...options,...verified].map(m=>[m.id,m])).values()];
});
function chooseConnection() {
  replaceKey.value=false;
  const c=selectedConnection.value;
  const saved=c && currentModel.value?.connection_id===c.id?currentModel.value:null;
  models.value=[];modelStatus.value='';modelError.value='';
  if(c){newConnection.value.provider=c.provider;newConnection.value.region=c.region;newConnection.value.workspace_id=c.workspace_id || '';}
  modelForm.value.model=saved?.model || Object.keys(c?.capabilities || {}).find(id=>c?.capabilities[id]?.chat) || c?.models?.find(m=>!m.purpose || m.purpose==='chat')?.id || (newConnection.value.provider==='deepseek'?'deepseek-flash':'qwen-plus');
  modelForm.value.thinking=saved?.thinking || 'auto';
}
function chooseProvider() {
  newConnection.value.api_key='';newConnection.value.region='cn';newConnection.value.workspace_id='';
  modelForm.value.connection_id=connections.value.find(c=>c.enabled && c.provider===newConnection.value.provider)?.id || '';
  chooseConnection();
}
const searchService=ref<{configured:boolean;model:string;state:string}|null>(null);
async function act(fn:()=>Promise<void>) {busy.value=true; error.value=''; try{await fn();}catch(e){error.value=(e as Error).message;}finally{busy.value=false;}}
async function load(initial=false){
  const [result,auxiliary]=await Promise.all([
    Promise.all([api<Settings>('/settings'),api<Connection[]>('/provider-connections'),api<Preference|null>('/model-preferences')]),
    Promise.allSettled([api<Usage>('/usage'),api<Job[]>('/jobs'),api<typeof searchService.value>('/embedding-service')]),
  ]);
  const preferences=props.appearance && props.appearance.version > result[0].version ? props.appearance : result[0];
  if(initial || !form.value)form.value={...preferences};
  connections.value=result[1];
  currentModel.value=result[2];
  if(initial || !connections.value.some(c=>c.enabled && c.id===modelForm.value.connection_id)){
    modelForm.value=result[2] || {connection_id:connections.value.find(c=>c.enabled)?.id || '',model:'',thinking:'auto'};
    chooseConnection();
  }
  if(auxiliary[0].status==='fulfilled')usage.value=auxiliary[0].value as Usage;
  jobsError.value=auxiliary[1].status==='rejected';
  if(auxiliary[1].status==='fulfilled'){jobs.value=auxiliary[1].value as Job[];jobsLoaded.value=true;}
  if(auxiliary[2].status==='fulfilled')searchService.value=auxiliary[2].value as typeof searchService.value;
  auxiliaryError.value=auxiliary.some(item=>item.status==='rejected')?'部分运行信息暂时无法读取，请稍后刷新。':'';
  applyTheme(preferences.theme);
}
async function save(){await act(async()=>{
  if(!form.value)return;
  const payload=Object.fromEntries(settingKeys.map(k=>[k,form.value![k as keyof Settings]]));
  form.value=await api<Settings>('/settings',{method:'PUT',body:JSON.stringify(payload)});
  if(auth.user)auth.user.timezone=form.value.timezone; applyTheme(form.value.theme);emit('saved',form.value);ElMessage.success('设置已保存');
});}
async function catalog(){await act(async()=>{const result=await api<{models:{id:string;name:string;purpose?:string}[];refreshed_at:string|null;error:string|null}>('/provider-connections/'+modelForm.value.connection_id+'/models?refresh=true');models.value=result.models.filter(m=>!m.purpose || m.purpose==='chat');modelStatus.value=result.error || '模型列表已更新';});}
async function enableModel(){await act(async()=>{
  modelStatus.value='';modelError.value='';
  const draft={...modelForm.value,model:modelForm.value.model.trim()};
  try {
    if(newConnection.value.api_key.trim()){
      setupStage.value='正在保存连接';
      const created=await post<Connection>('/provider-connections',{...newConnection.value,name:newConnection.value.name.trim() || (newConnection.value.provider==='deepseek'?'DeepSeek':'通义千问'),api_key:newConnection.value.api_key.trim(),workspace_id:newConnection.value.workspace_id.trim() || null});
      connections.value.push(created);draft.connection_id=created.id;modelForm.value.connection_id=created.id;newConnection.value.api_key='';newConnection.value.name='';
    }
    setupStage.value='正在测试模型';
    const result=await post<{capabilities:{chat:boolean;tools:boolean}}>('/provider-connections/'+draft.connection_id+'/test',{model:draft.model,thinking:draft.thinking});
    if(!result.capabilities.chat)throw new Error('模型未返回有效回复，请检查模型名称或 Key 权限');
    setupStage.value='正在启用模型';
    currentModel.value=await api<Preference>('/model-preferences',{method:'PUT',body:JSON.stringify(draft)});
    replaceKey.value=false;
    modelStatus.value='模型已启用，可以聊天、读取文档并预览任务变更。';
    await load();ElMessage.success('模型已启用，可以和小狒聊天了');
  } catch(e) {modelError.value=(e as Error).message;}
  finally {setupStage.value='';newConnection.value.api_key='';}
});}
async function remove(c:Connection){try{await ElMessageBox.confirm('删除此连接的凭据并停止后续调用？','删除 Key',{type:'warning'});}catch{return;}await act(async()=>{await api('/provider-connections/'+c.id,{method:'DELETE'});await load();});}
async function testVision(){await act(async()=>{
  const result=await post<{vision:boolean;note:string}>('/provider-connections/'+modelForm.value.connection_id+'/test-vision',{model:modelForm.value.model.trim(),thinking:modelForm.value.thinking});
  modelStatus.value=result.note;await load();
});}
async function notification(){
  if(!('Notification' in window) || permissionBusy.value)return;
  permissionBusy.value=true;permissionError.value='';
  try{notificationPermission.value=await Notification.requestPermission();}
  catch{permissionError.value='暂时无法请求通知权限，请稍后重试。';readNotificationPermission();}
  finally{permissionBusy.value=false;}
}
async function deleteAccount(){try{const label=auth.user?.email?'邮箱':'电话号码';const result=await ElMessageBox.prompt(`输入当前${label}，永久删除账户及全部在线数据。`,'删除账户',{inputValidator:(v:string)=>v===auth.identifier || `${label}不匹配`,type:'warning'});await act(async()=>{await post('/account-deletion',{confirm_identifier:result.value});await auth.logout().catch(()=>{});await router.replace('/auth');});}catch{/* dismissal */}}
onMounted(()=>act(()=>load(true)));
onMounted(()=>{readNotificationPermission();window.addEventListener('focus',readNotificationPermission);});
onUnmounted(()=>window.removeEventListener('focus',readNotificationPermission));
watch(tab,()=>{error.value='';});
watch(()=>props.appearance,settings=>{
  if(settings && form.value && settings.version > form.value.version)form.value={...form.value,version:settings.version,theme:settings.theme};
});
</script>
<template>
<section class="feature-page settings-panel">
  <header class="account-identity"><span class="account-identity-avatar" aria-hidden="true">{{auth.avatarLetter}}</span><div><strong>{{auth.displayName}}</strong><el-button v-if="!nicknameEditing" text :disabled="busy" @click="editNickname">修改昵称</el-button><form v-if="nicknameEditing" class="nickname-editor" @submit.prevent="saveNickname"><el-input v-model="nicknameDraft" aria-label="账户昵称" autocomplete="nickname" maxlength="30" placeholder="输入昵称，最多 30 个字符" :disabled="nicknameBusy" @input="nicknameError=''"/><p v-if="nicknameRemaining!==null" class="field-hint" role="status">每天最多修改 2 次，今天还可修改 {{nicknameRemaining}} 次。</p><p v-if="nicknameError" class="nickname-error" role="alert">{{nicknameError}}</p><div class="action-row"><el-button type="primary" native-type="submit" :loading="nicknameBusy" :disabled="nicknameRemaining===null || nicknameRemaining===0 || !nicknameDraft.trim() || nicknameDraft.trim()===auth.user?.nickname">保存昵称</el-button><el-button :disabled="nicknameBusy" @click="nicknameEditing=false;nicknameError=''">取消</el-button></div></form></div></header>
  <div class="account-settings-layout">
  <nav class="account-sections" aria-label="账户设置分区"><router-link v-for="section in sections" :key="section.id" :to="section.id==='preferences'?'/account':'/account?tab='+section.id" :class="{active:tab===section.id}" :aria-current="tab===section.id?'page':undefined">{{section.label}}</router-link></nav>
  <div class="account-settings-content">
  <el-alert v-if="error" :title="error" type="error" :closable="false" show-icon/>
  <HistoryPanel v-if="tab==='history'" :key="String(route.query.task || 'history')"/>
  <section v-if="tab==='model'" class="feature-section model-setup">
    <div class="model-setup-heading"><h2>小狒的对话模型</h2><router-link v-if="currentModel" to="/ai">去和小狒聊聊 →</router-link></div>
    <p class="model-current" role="status">{{currentModel ? '当前已启用：'+currentModel.model : '还未启用对话模型，保存后就可以和小狒聊天。'}}</p>
    <form @submit.prevent="enableModel">
      <div class="form-grid">
        <label>厂商<el-select v-model="newConnection.provider" aria-label="厂商" :disabled="busy" @change="chooseProvider"><el-option label="DeepSeek" value="deepseek"/><el-option label="通义千问 / 百炼" value="bailian"/></el-select></label>
        <label v-if="!selectedConnection || replaceKey">API Key<el-input v-model="newConnection.api_key" type="password" autocomplete="new-password" aria-label="API Key" :disabled="busy" :placeholder="selectedConnection?'Key 已保存，留空即可使用':'粘贴厂商提供的 API Key'"/></label>
        <label>模型<el-select v-model="modelForm.model" filterable allow-create default-first-option aria-label="模型 ID" :disabled="busy" placeholder="选择或输入模型名称" @change="modelStatus=''; modelError=''"><el-option v-for="m in modelOptions" :key="m.id" :label="m.name===m.id?m.id:m.name+' · '+m.id" :value="m.id"/></el-select></label>
      </div>
      <div class="action-row"><el-button type="primary" native-type="submit" :loading="!!setupStage" :disabled="busy || !modelForm.model.trim() || (!selectedConnection && !newConnection.api_key.trim())">{{setupStage || '保存并启用'}}</el-button><el-button v-if="selectedConnection && !replaceKey" text :disabled="busy" @click="replaceKey=true">更换 API Key</el-button></div>
    </form>
    <el-alert v-if="modelError" :title="modelError" type="error" :closable="false" show-icon/>
    <p v-if="modelStatus" class="model-feedback" role="status">{{modelStatus}}</p>
    <details class="model-advanced"><summary>高级设置</summary><p class="field-hint">Key 加密保存；模型测试会产生少量厂商用量。</p>
      <div class="form-grid">
        <label>已保存的连接<el-select v-model="modelForm.connection_id" aria-label="默认模型连接" :disabled="busy" @change="chooseConnection"><el-option v-for="c in connections.filter(c=>c.enabled)" :key="c.id" :label="c.name" :value="c.id"/></el-select></label>
        <label>思考档位<el-select v-model="modelForm.thinking" aria-label="思考档位" :disabled="busy"><el-option label="自动" value="auto"/><el-option label="快速" value="fast"/><el-option label="深度" value="deep"/></el-select></label>
        <label v-if="!selectedConnection || replaceKey">新连接名称（可选）<el-input v-model="newConnection.name" maxlength="100" aria-label="连接名称" :disabled="busy" placeholder="默认使用厂商名称"/></label>
        <label v-if="newConnection.provider==='bailian'">新 Key 地域<el-select v-model="newConnection.region" aria-label="地域" :disabled="busy"><el-option label="中国内地" value="cn"/><el-option label="新加坡" value="sg"/><el-option label="美国" value="us"/></el-select></label>
        <label v-if="newConnection.provider==='bailian'">业务空间 ID（可选，用于模型目录）<el-input v-model="newConnection.workspace_id" aria-label="百炼业务空间 ID" maxlength="80" :disabled="busy"/></label>
      </div>
      <div class="action-row"><el-button :disabled="busy || !modelForm.connection_id" @click="catalog">刷新模型目录</el-button><el-button :disabled="busy || !selectedConnection || !modelForm.model.trim()" @click="testVision">测试图片识别</el-button></div>
      <p class="field-hint">图片中的文字可直接读取；识别照片或图表画面需通过图片识别测试。</p>
      <div class="connection-list"><div v-for="c in connections.filter(c=>c.enabled)" :key="c.id" class="settings-row"><span>{{c.name}} · {{c.key_mask}}</span><el-button text :disabled="busy" @click="remove(c)">删除凭据</el-button></div></div>
    </details>
  </section>
  <form v-if="form && tab==='preferences'" @submit.prevent="save" class="feature-section preferences-form">
    <header class="preferences-heading"><h2>偏好设置</h2><el-button type="primary" native-type="submit" :loading="busy" :disabled="busy">保存设置</el-button></header>
    <section class="preference-section" aria-labelledby="preference-display"><h3 id="preference-display">显示与地区</h3><div class="preference-fields preference-fields-pair">
      <label>主题<el-select v-model="form.theme" aria-label="主题"><el-option label="浅色" value="light"/><el-option label="夜间" value="dark"/><el-option label="暖色" value="warm"/></el-select></label>
      <label>时区<el-input v-model="form.timezone" aria-label="账户时区"/></label>
    </div></section>
    <section class="preference-section" aria-labelledby="preference-schedule"><h3 id="preference-schedule">工作时间</h3><div class="preference-fields">
      <div class="preference-fields-pair">
      <label>工作开始<input type="time" v-model="form.work_start" aria-label="工作开始"/></label><label>工作结束<input type="time" v-model="form.work_end" aria-label="工作结束"/></label>
      </div>
      <div class="preference-capacity"><label for="preference-capacity">每日容量<span>计划每天投入的时间</span></label><div><el-input-number id="preference-capacity" v-model="form.daily_capacity" :min="1" :max="1440" aria-label="每日容量" placeholder="不限"/><span>分钟</span></div></div>
    </div></section>
    <section class="preference-section" aria-labelledby="preference-notification"><h3 id="preference-notification">通知与天气</h3><div class="preference-fields preference-options">
      <label class="preference-toggle"><span class="preference-toggle-copy"><span>浏览器内到期通知</span><small>任务到期时显示提醒。</small></span><input type="checkbox" v-model="form.notifications_enabled" aria-label="浏览器内到期通知" :disabled="busy"/></label>
      <section v-if="form.notifications_enabled" class="notification-permission" :class="'permission-'+notificationPermission"><span class="notification-permission-icon"><el-icon><Bell/></el-icon></span><div><h4>{{permissionTitle}}</h4><p>{{permissionHelp}}</p><p v-if="permissionError" class="nickname-error" role="alert">{{permissionError}}</p><div class="notification-permission-actions"><el-button v-if="notificationPermission==='default'" size="small" :loading="permissionBusy" @click="notification">开启系统通知</el-button><el-button size="small" text @click="emit('notification-preview')">预览提醒</el-button></div></div></section>
      <label class="preference-toggle"><span class="preference-toggle-copy"><span>辅助天气</span><small>在清单中显示所选城市的天气。</small></span><input type="checkbox" v-model="form.weather_enabled" aria-label="辅助天气" :disabled="busy"/></label>
      <label v-if="form.weather_enabled" class="preference-dependent">天气城市<el-select v-model="form.weather_city" aria-label="天气城市" filterable allow-create default-first-option placeholder="滑动选择或搜索城市" popper-class="weather-city-options"><el-option-group v-for="group in weatherCityGroups" :key="group.label" :label="group.label"><el-option v-for="city in group.cities" :key="city" :label="city" :value="city"/></el-option-group></el-select></label>
    </div></section>
    <section class="preference-section" aria-labelledby="preference-assistant"><h3 id="preference-assistant">助手与推荐</h3><div class="preference-fields preference-options">
      <label class="preference-toggle"><span class="preference-toggle-copy"><span>使用 AI 记忆</span><small>在回答中参考已保存的记忆。</small></span><input type="checkbox" v-model="form.memory_enabled" aria-label="使用 AI 记忆" :disabled="busy"/></label>
      <label class="preference-toggle"><span class="preference-toggle-copy"><span>智能追问</span><small>回答后提供可继续讨论的问题。</small></span><input type="checkbox" v-model="form.followups_enabled" aria-label="智能追问" :disabled="busy"/></label>
      <label class="preference-toggle"><span class="preference-toggle-copy"><span>资讯推荐</span><small>按推荐时间整理资讯。</small></span><input type="checkbox" v-model="form.news_enabled" aria-label="资讯推荐" :disabled="busy"/></label>
      <label class="preference-toggle"><span class="preference-toggle-copy"><span>今日工作建议</span><small>结合任务生成当日安排建议。</small></span><input type="checkbox" v-model="form.suggestions_enabled" aria-label="今日工作建议" :disabled="busy"/></label>
      <label v-if="form.news_enabled || form.suggestions_enabled" class="preference-dependent recommendation-time">推荐时间<input type="time" v-model="form.recommendation_time" aria-label="推荐时间"/></label>
      <details class="preference-limits"><summary>自动推荐与调用上限</summary><p>推荐按指定时间运行，任务建议需采纳后才生效。</p>
        <div class="preference-fields-pair"><label>每日后台调用上限<el-input-number v-model="form.daily_call_limit" :min="0" :max="100" aria-label="后台调用上限"/></label><label>每日后台 Token 上限<el-input-number v-model="form.daily_token_limit" :min="0" :max="2000000" aria-label="后台 Token 上限"/></label></div>
      </details>
    </div></section>
  </form>
  <details v-if="tab==='preferences'" class="preferences-companion"><summary><span>小狒桌宠</span><small>外观与陪伴方式 · 即时生效</small></summary><DesktopPetSettings/></details>
  <section v-if="tab==='usage'" class="feature-section account-usage" aria-labelledby="usage-heading">
    <header class="usage-heading"><h2 id="usage-heading">今日用量</h2><el-button :loading="busy" :disabled="busy" @click="act(load)">刷新运行状态</el-button></header>
    <el-alert v-if="auxiliaryError" :title="auxiliaryError" type="warning" :closable="false"/>
    <dl v-if="usage" class="usage-metrics">
      <div><dt>对话与测试</dt><dd>{{usage.chat_calls}}</dd></div>
      <div><dt>自动调用</dt><dd>{{usage.background_calls}} <span class="usage-limit">/ {{usage.call_limit}}</span></dd></div>
      <div><dt>后台 Token</dt><dd>{{usage.background_tokens}}</dd></div>
    </dl>
    <p v-else class="usage-unavailable muted">{{busy?'正在读取今日用量…':'暂未读取到今日用量，请刷新重试。'}}</p>
    <section class="usage-history" aria-labelledby="usage-history-heading">
      <div><h3 id="usage-history-heading">历史检索</h3><p v-if="searchService" class="muted">{{!searchService.configured?'按关键词查找历史':searchService.state==='ready'?'语义搜索已就绪':searchService.state==='failed'?'语义搜索暂时不可用，仍可按关键词查找':'正在准备历史记录，暂用关键词搜索'}}</p></div>
      <router-link to="/account?tab=history">查看历史与记忆 <span aria-hidden="true">→</span></router-link>
    </section>
    <details class="usage-details"><summary>运行详情</summary><div class="usage-detail-content"><JobRunChart :jobs="jobs" :loaded="jobsLoaded" :failed="jobsError"/><p v-if="usage?.note" class="usage-note">{{usage.note}}</p></div></details>
  </section>
  <section v-if="tab==='security'" class="feature-section account-security"><h2>账户安全</h2><p v-if="auth.user?.nickname" class="muted">登录账号：{{auth.identifier}}</p><div class="account-security-row"><div><h3>退出登录</h3><p class="muted">退出当前设备上的账户。</p></div><el-button :disabled="busy" @click="logout">退出当前账户</el-button></div><div class="account-security-row danger-action"><div><h3>删除账户</h3><p class="muted">永久删除账户及全部在线数据，无法恢复。</p></div><el-button type="danger" plain :disabled="busy" @click="deleteAccount">永久删除账户</el-button></div></section>
  </div></div>
</section>
</template>
<style scoped src="../preferences-layout.css"></style>
<style scoped src="../account-usage.css"></style>
