<script setup lang="ts">
import {computed,onMounted,ref,onUnmounted} from 'vue';
import {ElMessage} from 'element-plus';
import {api} from '../api';
import type {AdminUsers,AdminUsageDetail,AdminPersona} from '../admin-types';
import AdminUserCharts from './AdminUserCharts.vue';

const tab=ref<'users'|'persona'>('users'),users=ref<AdminUsers|null>(null),query=ref(''),page=ref(1);
const start=ref(''),end=ref(''),busy=ref(false),error=ref('');
const detail=ref<AdminUsageDetail|null>(null),detailOpen=ref(false),detailBusy=ref(false),detailError=ref('');
const persona=ref<AdminPersona|null>(null),draft=ref(''),personaBusy=ref(false),personaError=ref('');
const dirty=computed(()=>Boolean(persona.value && draft.value!==persona.value.content));
let listGeneration=0,detailGeneration=0;
const format=(value:number)=>new Intl.NumberFormat('zh-CN').format(value);
const dateTime=(value:string)=>new Intl.DateTimeFormat('zh-CN',{dateStyle:'medium',timeStyle:'short'}).format(new Date(value));
const purpose:Record<string,string>={chat:'聊天',probe:'模型验证',news:'资讯',suggestions:'任务建议',embedding:'历史索引','embedding-query':'历史检索'};
const states:Record<string,string>={settled:'已结算',reserved:'处理中',unknown:'用量未知'};
function filters(){
  const params=new URLSearchParams();
  if(start.value)params.set('start',start.value);
  if(end.value)params.set('end',end.value);
  return params;
}
async function loadUsers(reset=false){
  if(reset)page.value=1;
  const generation=++listGeneration;busy.value=true;error.value='';
  try{
    if(start.value && end.value && end.value<start.value)throw new Error('结束日期不能早于开始日期');
    const params=filters();params.set('q',query.value.trim());params.set('page',String(page.value));params.set('page_size','20');
    const result=await api<AdminUsers>('/admin/users?'+params);
    if(generation===listGeneration)users.value=result;
  }catch(e){if(generation===listGeneration){users.value=null;error.value=(e as Error).message;}}
  finally{if(generation===listGeneration)busy.value=false;}
}
async function showUsage(identifier:string){
  const generation=++detailGeneration;detailOpen.value=true;detail.value=null;detailError.value='';detailBusy.value=true;
  try{const result=await api<AdminUsageDetail>('/admin/users/'+encodeURIComponent(identifier)+'/usage?'+filters());if(generation===detailGeneration)detail.value=result;}
  catch(e){if(generation===detailGeneration)detailError.value=(e as Error).message;}
  finally{if(generation===detailGeneration)detailBusy.value=false;}
}
function closeDetail(){detailGeneration++;detail.value=null;detailBusy.value=false;}
async function loadPersona(){
  personaBusy.value=true;personaError.value='';
  try{const result=await api<AdminPersona>('/admin/persona');persona.value=result;draft.value=result.content;}
  catch(e){personaError.value=(e as Error).message;}
  finally{personaBusy.value=false;}
}
async function savePersona(){
  if(!persona.value || !draft.value.trim() || personaBusy.value)return;
  personaBusy.value=true;personaError.value='';
  try{
    const result=await api<AdminPersona>('/admin/persona',{method:'PUT',body:JSON.stringify({content:draft.value.trim(),version:persona.value.version})});
    persona.value=result;draft.value=result.content;ElMessage.success('AI 人设已保存，后续聊天将使用新人设');
  }catch(e){personaError.value=(e as Error).message;}
  finally{personaBusy.value=false;}
}
function chooseTab(value:'users'|'persona'){tab.value=value;if(value==='persona' && !persona.value && !personaBusy.value)void loadPersona();}
onMounted(()=>void loadUsers());
onUnmounted(()=>{listGeneration++;detailGeneration++;});
</script>

<template>
  <section class="admin-panel" aria-label="管理后台">
    <p class="admin-intro">查看注册用户和模型用量，管理全站 AI 助手的交流风格。</p>
    <nav class="admin-tabs" aria-label="管理项目">
      <button type="button" :aria-pressed="tab==='users'" @click="chooseTab('users')">用户与用量</button>
      <button type="button" :aria-pressed="tab==='persona'" @click="chooseTab('persona')">AI 人设</button>
    </nav>
    <section v-show="tab==='users'" aria-label="用户与用量">
      <dl v-if="users" class="admin-summary">
        <div><dt>注册用户</dt><dd>{{format(users.summary.total_users)}}<small>人</small></dd></div>
        <div><dt>已报告 Token</dt><dd>{{format(users.summary.reported_tokens)}}</dd></div>
        <div><dt>模型调用</dt><dd>{{format(users.summary.calls)}}<small>次</small></dd></div>
        <div><dt>未报告完整用量</dt><dd>{{format(users.summary.unreported_calls)}}<small>次</small></dd></div>
      </dl>
      <form class="admin-filters" @submit.prevent="loadUsers(true)">
        <label class="admin-search">查找用户<el-input v-model="query" aria-label="搜索注册用户" maxlength="100" clearable placeholder="邮箱、手机号、昵称或管理员账号"/></label>
        <label>开始日期<input v-model="start" type="date" aria-label="用量开始日期"/></label>
        <label>结束日期<input v-model="end" type="date" aria-label="用量结束日期"/></label>
        <el-button type="primary" native-type="submit" :loading="busy">查询</el-button>
        <el-button :disabled="busy" @click="loadUsers()">刷新</el-button>
      </form>
      <p class="admin-note">不选日期则统计全部历史用量，日期按各用户的账户时区计算。Token 为应用记录的已报告用量；未知用量和预留值不会计入实际消耗。</p>
      <p v-if="error" role="alert" class="admin-error">{{error}}</p>
      <div v-if="busy" role="status" class="admin-loading">正在读取用户与用量…</div>
      <template v-if="users">
        <div class="admin-table" aria-label="注册用户列表">
          <el-table :data="users.items" empty-text="没有匹配的注册用户" row-key="id">
            <el-table-column label="注册用户" min-width="210"><template #default="{row}"><div class="admin-user-name">{{row.nickname || row.identifier}} <span v-if="row.is_admin" class="admin-role">管理员</span></div><div class="admin-note">{{row.identifier}}</div></template></el-table-column>
            <el-table-column label="注册时间" min-width="175"><template #default="{row}">{{dateTime(row.created_at)}}</template></el-table-column>
            <el-table-column label="输入 Token" min-width="120" align="right"><template #default="{row}">{{format(row.usage.input_tokens)}}</template></el-table-column>
            <el-table-column label="输出 Token" min-width="120" align="right"><template #default="{row}">{{format(row.usage.output_tokens)}}</template></el-table-column>
            <el-table-column label="已报告合计" min-width="125" align="right"><template #default="{row}">{{format(row.usage.reported_tokens)}}</template></el-table-column>
            <el-table-column label="调用 / 未报告" min-width="125" align="right"><template #default="{row}">{{format(row.usage.calls)}} / {{format(row.usage.unreported_calls)}}</template></el-table-column>
            <el-table-column label="信息" width="95"><template #default="{row}"><el-button text @click="showUsage(row.id)" :aria-label="'查看 '+row.identifier+' 的信息'">查看用户</el-button></template></el-table-column>
          </el-table>
        </div>
        <div class="admin-pagination"><span>共 {{format(users.total)}} 位用户</span><el-pagination v-model:current-page="page" :page-size="20" :total="users.total" layout="prev, pager, next" :pager-count="5" @current-change="loadUsers()"/></div>
      </template>
    </section>
    <section v-show="tab==='persona'" class="admin-persona" aria-label="AI 人设编辑">
      <h2>AI 人设</h2>
      <p>设置助手的身份、语气、交流方式和回应习惯。保存后，对所有用户的后续聊天生效，网页和桌宠共用。</p>
      <form @submit.prevent="savePersona">
        <label for="admin-persona-content">人设描述</label>
        <el-input id="admin-persona-content" v-model="draft" type="textarea" :rows="12" maxlength="8000" show-word-limit aria-label="AI 人设描述" :disabled="personaBusy || !persona" placeholder="例如：你是一位温和、务实的工作伙伴。回答简洁，先理解需求，再给出可执行的建议。"/>
        <p class="admin-note">任务创建、修改和删除仍需用户确认。人设描述不能授予用户数据访问权限。</p>
        <p v-if="persona" class="admin-note">版本 {{persona.version}} · 最近更新 {{dateTime(persona.updated_at)}}<span v-if="dirty"> · 有未保存的修改</span></p>
        <p v-if="personaError" role="alert" class="admin-error">{{personaError}}</p>
        <div class="admin-persona-actions"><el-button type="primary" native-type="submit" :loading="personaBusy" :disabled="!persona || !draft.trim() || !dirty">保存人设</el-button><el-button :disabled="personaBusy || !persona" @click="draft=persona!.default_content">填入默认人设</el-button><el-button :disabled="personaBusy" @click="loadPersona">重新读取</el-button></div>
      </form>
    </section>
    <el-dialog v-model="detailOpen" title="用户信息与用量" width="min(1040px, calc(100vw - 32px))" top="5vh" @closed="closeDetail">
      <p v-if="detailBusy" role="status">正在读取用量明细…</p>
      <p v-if="detailError" role="alert" class="admin-error">{{detailError}}</p>
      <template v-if="detail">
        <div class="admin-detail-scroll">
        <h3>{{detail.user.nickname || detail.user.identifier}} <small>{{detail.user.identifier}}</small></h3>
        <p class="admin-note">注册于 {{dateTime(detail.user.created_at)}} · 时区 {{detail.user.timezone}} · {{detail.user.is_admin?'管理员':'普通用户'}}</p>
        <AdminUserCharts :detail="detail"/>
        <p class="admin-note">处理中 {{detail.summary.pending_calls}} 次 · 用量未知 {{detail.summary.unknown_calls}} 次 · 未报告完整用量 {{detail.summary.unreported_calls}} 次（预留 {{format(detail.summary.unreported_reserved_tokens)}} Token，仅为预算预留）。</p>
        <details class="admin-call-details"><summary>查看调用明细（最近 100 条）</summary>
        <h4>调用记录 <small>所选日期内最近 100 条</small></h4>
        <div class="admin-table"><el-table :data="detail.events" empty-text="暂无调用记录"><el-table-column label="时间" min-width="170"><template #default="{row}">{{dateTime(row.created_at)}}</template></el-table-column><el-table-column prop="model" label="模型" min-width="160"/><el-table-column label="用途" min-width="95"><template #default="{row}">{{purpose[row.purpose] || row.purpose}}</template></el-table-column><el-table-column label="输入 / 输出" min-width="125"><template #default="{row}">{{row.input_tokens===null?'—':format(row.input_tokens)}} / {{row.output_tokens===null?'—':format(row.output_tokens)}}</template></el-table-column><el-table-column label="状态" min-width="100"><template #default="{row}">{{states[row.state] || row.state}}</template></el-table-column></el-table></div>
        </details>
        </div>
      </template>
    </el-dialog>
  </section>
</template>

<style scoped>
.admin-detail-scroll{max-height:calc(90dvh - 90px);overflow-y:auto;overflow-x:hidden;padding-right:8px}.admin-detail-scroll>h3{margin:0 0 8px;overflow-wrap:anywhere}.admin-call-details{border-top:1px solid var(--el-border-color);margin-top:20px;padding-top:18px}.admin-call-details>summary{cursor:pointer;color:var(--el-color-primary);font-size:13px;width:fit-content;padding:5px 0}
.admin-panel{max-width:1400px;min-width:0}.admin-intro,.admin-note,.admin-persona>p{color:var(--el-text-color-secondary);line-height:1.7}.admin-intro{margin:0 0 24px}.admin-note{font-size:12px}.admin-tabs{display:flex;gap:8px;border-bottom:1px solid var(--el-border-color);padding-bottom:14px;margin-bottom:28px}.admin-tabs button{font:inherit;cursor:pointer;border:0;border-radius:6px;padding:10px 16px;background:transparent;color:var(--el-text-color-secondary)}.admin-tabs button[aria-pressed=true]{background:var(--el-fill-color-light);color:var(--el-color-primary)}.admin-tabs button:focus-visible{outline:2px solid var(--el-color-primary);outline-offset:2px}.admin-summary{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:24px;margin:0 0 30px}.admin-summary div{border-left:2px solid var(--el-border-color);padding-left:16px}.admin-summary dt{color:var(--el-text-color-secondary);font-size:13px}.admin-summary dd{margin:10px 0 0;font-size:clamp(23px,2.3vw,32px);font-weight:600;font-variant-numeric:tabular-nums;overflow-wrap:anywhere}.admin-summary small{font-size:12px;font-weight:400;margin-left:6px}.admin-filters{display:flex;align-items:end;gap:14px;flex-wrap:wrap}.admin-filters label{display:grid;gap:7px;font-size:13px}.admin-search{flex:1;min-width:210px}.admin-filters input[type=date]{height:32px;border:1px solid var(--el-border-color);border-radius:4px;padding:0 10px;background:var(--el-bg-color);color:var(--el-text-color-primary);font:inherit;min-width:0}.admin-table{max-width:100%;overflow:hidden;border-top:1px solid var(--el-border-color);margin-top:20px}.admin-user-name{font-weight:500;overflow-wrap:anywhere}.admin-role{font-size:11px;color:var(--el-color-primary);margin-left:8px}.admin-pagination{display:flex;justify-content:space-between;align-items:center;gap:12px;margin:22px 0;font-size:13px;color:var(--el-text-color-secondary);flex-wrap:wrap}.admin-loading{padding:16px 0;color:var(--el-text-color-secondary)}.admin-error{color:var(--el-color-danger);line-height:1.6}.admin-persona{max-width:850px}.admin-persona h2{font-size:23px;margin:0 0 16px}.admin-persona form>label{display:block;margin:26px 0 12px;font-size:14px}.admin-persona-actions{display:flex;flex-wrap:wrap;gap:12px;margin-top:22px}.admin-persona-actions .el-button+.el-button{margin-left:0}.admin-panel h3 small,.admin-panel h4 small{font-weight:400;font-size:12px;color:var(--el-text-color-secondary)}@media(max-width:700px){.admin-summary{grid-template-columns:repeat(2,minmax(0,1fr));gap:24px 16px}.admin-filters{gap:12px}.admin-search{flex-basis:100%}.admin-filters label:not(.admin-search){flex:1;min-width:130px}.admin-tabs{margin-bottom:24px}.admin-panel h3{overflow-wrap:anywhere}}
</style>
