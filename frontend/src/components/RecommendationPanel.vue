<script setup lang="ts">
import {computed, onMounted, onUnmounted, ref, watch} from 'vue';
import {api,post} from '../api';
import type {Recommendation,Settings} from '../advanced-types';

const items=ref<Recommendation[]>([]), settings=ref<Settings|null>(null);
const busy=ref(false), error=ref(''), note=ref(''), editing=ref(false);
const draft=ref<string[]>([]), view=ref('all');
const page=ref(1), pageSize=5;
const suggestedTopics=['AI','科技','编程','设计','产品','生活','文化'];
interface NewsStatus {id:string;state:string;message?:string;count?:number|null;retry_at?:string;outcome?:string}
const insufficientSources=ref(false);
const updating=ref(false);
let pollTimer:ReturnType<typeof setTimeout>|undefined,disposed=false;
function stopPolling(){if(pollTimer)clearTimeout(pollTimer);pollTimer=undefined;}
function pollLater(){stopPolling();if(!disposed && updating.value)pollTimer=setTimeout(async()=>{
  if(busy.value){pollLater();return;}
  await act(load);
},2000);}
function applyStatus(status:NewsStatus|null){
  insufficientSources.value=status?.outcome==='insufficient_sources';
  updating.value=!!status && ['pending','running'].includes(status.state);
  if(updating.value)note.value=status?.message ? `整理暂未完成：${status.message}，后台将自动重试。` : '正在检索并整理资讯，完成后将自动显示。';
  else if(status?.state==='failed'){error.value=status.message || '资讯整理失败，请重新点击更新资讯。';note.value='';}
  else if(status?.state==='completed')note.value=status.message || '';
  pollLater();
}
const topics=computed(()=>settings.value?.news_topics || []);
const dirty=computed(()=>JSON.stringify(draft.value)!==JSON.stringify(topics.value));
const news=computed(()=>items.value.filter(item=>item.kind==='news' && (item.state!=='dismissed' || item.bookmarked)));
function content(item:Recommendation) {
  if(item.ai_curated)return {item,excerpt:item.summary || '',overview:''};
  const [body,overview='']=item.reason.split('\n本批资讯概览：');
  const excerpt=body!.replace(/^(?:通用资讯\s*·[^\n]*|与当前明确兴趣或工作主题相关：[^\n]*|关注主题：[^\n]*)\n?/, '').trim();
  return {item,excerpt,overview:overview.trim()};
}
const cards=computed(()=>news.value.filter(item=>view.value!=='saved' || item.bookmarked).map(content));
const pagedCards=computed(()=>cards.value.slice((page.value-1)*pageSize,page.value*pageSize));
// Background reloads keep the page; switching views or losing pages snaps back into range.
function switchView(next:string){view.value=next;page.value=1;}
watch(cards,()=>{const max=Math.max(1,Math.ceil(cards.value.length/pageSize));if(page.value>max)page.value=max;});
const overviews=computed(()=>[...new Set(cards.value.map(card=>card.overview).filter(Boolean))]);
const hasLoaded=ref(false);
async function act(fn:()=>Promise<void>) {
  if(busy.value)return;
  busy.value=true;error.value='';
  try{await fn();}catch(e){error.value=(e as Error).message;updating.value=false;stopPolling();}finally{busy.value=false;}
}
async function load() {
  const keepDraft=hasLoaded.value && dirty.value;
  const [loadedItems,loadedSettings,status]=await Promise.all([api<Recommendation[]>('/recommendations?kind=news'),api<Settings>('/settings'),api<NewsStatus|null>('/recommendations/news-status')]);
  items.value=loadedItems;settings.value=loadedSettings;note.value='';
  if(!keepDraft)draft.value=[...(loadedSettings.news_topics || [])];
  if(!hasLoaded.value){editing.value=!draft.value.length;hasLoaded.value=true;}
  applyStatus(status);
}
function editTopics(){editing.value=!editing.value;}
async function saveTopics(){await act(async()=>{
  if(!settings.value)return;
  settings.value=await api<Settings>('/news-topics',{method:'PUT',body:JSON.stringify({version:settings.value.version,topics:draft.value})});
  draft.value=[...(settings.value.news_topics || [])];editing.value=false;
  updating.value=false;stopPolling();
  items.value=await api<Recommendation[]>('/recommendations?kind=news');
  note.value=topics.value.length?'关注已保存，只显示相关主题的资讯。':'已恢复综合资讯。';
});}
async function refresh(){await act(async()=>{
  const job=await post<NewsStatus>('/recommendations/refresh?kind=news');
  if(job.state==='completed' || job.state==='failed')await load();
  else applyStatus({...job,state:job.state || 'pending'});
});}
async function feedback(item:Recommendation,action:string){await act(async()=>{await post('/recommendations/'+item.id+'/feedback',{action});await load();});}
function published(value:string){return new Date(value).toLocaleDateString('zh-CN',{month:'long',day:'numeric'});}
function sourceLink(value:string|null|undefined){return !!value && /^https?:\/\//i.test(value);}
onMounted(()=>act(load));
onUnmounted(()=>{disposed=true;stopPolling();});
</script>
<template>
  <section class="feature-page news-panel" aria-label="资讯">
    <el-alert v-if="error" :title="error" type="error" :closable="false"><el-button text :disabled="busy" @click="act(load)">刷新结果重试</el-button></el-alert>
    <header class="news-toolbar">
      <div><h2>关注内容</h2><p>{{topics.length ? 'AI 按关注主题整理，附原始来源' : 'AI 整理资讯，附原始来源'}}</p></div>
      <div class="news-toolbar-actions">
        <el-button v-if="settings?.news_enabled" type="primary" :loading="updating" :disabled="busy || dirty || updating" @click="refresh">更新资讯</el-button>
        <el-button text :disabled="busy" @click="act(load)">刷新结果</el-button>
      </div>
    </header>
    <section v-if="settings" class="news-interests" aria-label="关注设置">
      <div class="news-interest-summary">
        <div class="news-topic-list"><span v-if="!topics.length" class="news-all-topics">综合资讯</span><el-tag v-for="topic in topics" :key="topic" effect="plain">{{topic}}</el-tag></div>
        <el-button text :disabled="busy" :aria-expanded="editing" aria-controls="news-topic-editor" @click="editTopics">{{editing ? '收起' : '编辑关注'}}</el-button>
      </div>
      <form v-if="editing" id="news-topic-editor" class="news-topic-editor" @submit.prevent="saveTopics">
        <label for="news-topic-input">想看哪些内容？</label>
        <el-select id="news-topic-input" v-model="draft" multiple filterable allow-create default-first-option :multiple-limit="8" :disabled="busy" aria-label="关注主题" placeholder="输入主题，如 AI，回车添加">
          <el-option v-for="topic in suggestedTopics" :key="topic" :label="topic" :value="topic"/>
        </el-select>
        <div class="news-topic-editor-footer"><p>最多 8 个主题；留空则推荐综合资讯。</p><el-button native-type="submit" :loading="busy" :disabled="!dirty || busy">保存关注</el-button></div>
      </form>
    </section>
    <p v-if="note" class="news-note" role="status">{{note}}</p>
    <div v-if="settings && !settings.news_enabled" class="news-disabled"><p>资讯推荐已关闭，已收藏的文章仍可阅读。</p><router-link to="/account">前往偏好设置 →</router-link></div>
    <nav v-if="news.length" class="news-filter" aria-label="资讯筛选">
      <button :class="{active:view==='all'}" :aria-pressed="view==='all'" @click="switchView('all')">推荐</button>
      <button :class="{active:view==='saved'}" :aria-pressed="view==='saved'" @click="switchView('saved')">已收藏</button>
      <span>{{cards.length}} 篇</span>
    </nav>
    <div v-if="busy && !hasLoaded" class="news-loading" role="status"><el-skeleton :rows="5" animated/></div>
    <div v-else-if="updating && !cards.length" class="news-loading"><el-skeleton :rows="5" animated/></div>
    <div v-else-if="!cards.length && !error && settings?.news_enabled" class="news-empty">
      <h3>{{view==='saved' ? '还没有收藏的文章' : insufficientSources ? '暂未取得相关报道' : topics.length ? '暂无相关资讯' : '还没有资讯'}}</h3>
      <p>{{view==='saved' ? '阅读时点击收藏，方便以后查看。' : insufficientSources ? '本次检索来源不足，不代表没有相关资讯。请稍后重试。' : '点击更新资讯，由 AI 筛选相关内容、整理要点并附上来源。'}}</p>
    </div>
    <details v-if="overviews.length" class="news-overview"><summary>本期概览</summary><p v-for="overview in overviews" :key="overview" class="preserve-lines">{{overview}}</p></details>
    <div class="news-list">
      <article v-for="{item,excerpt} in pagedCards" :key="item.id" class="news-article">
        <div class="news-article-meta"><span v-if="item.topic">{{item.topic.replace(/^通用资讯·/,'')}}</span><span v-if="item.ai_curated">AI 整理 · 依据来源摘要</span><span v-if="item.source">{{item.source}}</span><time v-if="item.published_at" :datetime="item.published_at">{{published(item.published_at)}}</time></div>
        <h2><a v-if="sourceLink(item.url)" :href="item.url!" target="_blank" rel="noopener noreferrer">{{item.title}}</a><span v-else>{{item.title}}</span></h2>
        <p v-if="excerpt" class="news-excerpt" :class="{curated:item.ai_curated}">{{excerpt}}</p>
        <ul v-if="item.points?.length" class="news-points"><li v-for="point in item.points" :key="point">{{point}}</li></ul>
        <ul v-if="item.sources?.length" class="news-sources" aria-label="资讯来源">
          <li v-for="(source,index) in item.sources" :key="source.url">
            <span>来源 {{index+1}}</span><a v-if="sourceLink(source.url)" :href="source.url" target="_blank" rel="noopener noreferrer">{{source.title}} ↗</a>
            <small>{{source.site}} · {{source.published_at ? published(source.published_at) : '发布日期未提供'}}</small>
          </li>
        </ul>
        <footer class="news-article-footer">
          <a v-if="sourceLink(item.url)" :href="item.url!" target="_blank" rel="noopener noreferrer">阅读原文 ↗</a>
          <div class="news-article-actions">
            <el-button text :disabled="busy" :aria-pressed="item.bookmarked" @click="feedback(item,'bookmark')">{{item.bookmarked ? '已收藏' : '收藏'}}</el-button>
            <el-dropdown trigger="click" :disabled="busy" @command="(action:string)=>feedback(item,action)"><el-button text :disabled="busy" :aria-label="'更多操作：'+item.title">更多</el-button><template #dropdown><el-dropdown-menu>
              <el-dropdown-item command="useful">有用</el-dropdown-item>
              <el-dropdown-item command="skip">跳过这篇</el-dropdown-item>
              <el-dropdown-item divided command="less_topic">少推荐此主题</el-dropdown-item>
              <el-dropdown-item command="block_topic">屏蔽此主题</el-dropdown-item>
              <el-dropdown-item v-if="item.source" command="block_source">屏蔽此来源</el-dropdown-item>
              <el-dropdown-item command="unblock">解除主题 / 来源屏蔽</el-dropdown-item>
            </el-dropdown-menu></template></el-dropdown>
          </div>
        </footer>
      </article>
    </div>
    <el-pagination v-if="cards.length>pageSize" class="news-pagination" background layout="prev, pager, next" :total="cards.length" :page-size="pageSize" :current-page="page" :aria-label="'资讯分页，第 '+page+' 页'" @current-change="(p:number)=>page=p"/>
  </section>
</template>
<style scoped src="../news-layout.css"></style>
<style scoped>
.news-pagination{margin-top:16px;justify-content:center;}
</style>
