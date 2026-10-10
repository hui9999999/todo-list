<script setup lang="ts">
import {computed} from 'vue';
import type {Job} from '../advanced-types';
const props=defineProps<{jobs:Job[];loaded:boolean;failed:boolean}>();
const kinds:Record<string,string>={agent:'助手回答',embedding:'历史索引',news:'资讯推荐',suggestions:'任务建议',maintenance:'日常整理',forget:'遗忘清理'};
const states=[{id:'completed',label:'已完成'},{id:'running',label:'处理中'},{id:'pending',label:'等待处理'},{id:'failed',label:'失败'},{id:'cancelled',label:'已取消'},{id:'other',label:'其他状态'}];
const stateOf=(job:Job)=>states.some(state=>state.id===job.state)?job.state:'other';
const kindOf=(job:Job)=>kinds[job.kind] || job.kind;
const stateLabel=(job:Job)=>states.find(state=>state.id===stateOf(job))!.label;
const rows=computed(()=>{
  const grouped=new Map<string,{kind:string;label:string;total:number;counts:Record<string,number>}>();
  for(const job of props.jobs){
    if(!grouped.has(job.kind))grouped.set(job.kind,{kind:job.kind,label:kindOf(job),total:0,counts:{}});
    const row=grouped.get(job.kind)!,state=stateOf(job);row.total++;row.counts[state]=(row.counts[state] || 0)+1;
  }
  return [...grouped.values()].sort((a,b)=>b.total-a.total || a.label.localeCompare(b.label,'zh-CN')).map(row=>({...row,description:`${row.label}：共 ${row.total} 条，`+states.filter(state=>row.counts[state.id]).map(state=>`${state.label} ${row.counts[state.id]} 条`).join('，')}));
});
const legend=computed(()=>states.map(state=>({...state,count:props.jobs.filter(job=>stateOf(job)===state.id).length})).filter(state=>state.count));
const axisMax=computed(()=>Math.ceil(Math.max(1,...rows.value.map(row=>row.total))/4)*4);
const ticks=computed(()=>Array.from({length:5},(_,index)=>index*axisMax.value/4));
const errors=computed(()=>props.jobs.filter(job=>job.error));
</script>
<template>
  <p v-if="failed" class="run-chart-message" role="status">{{loaded?'运行记录刷新失败，以下为上次读取结果。':'运行记录暂时无法读取，请稍后刷新。'}}</p>
  <p v-if="!loaded && !failed" class="run-chart-message" role="status">正在读取运行记录…</p>
  <p v-else-if="loaded && !jobs.length" class="run-chart-message">暂无运行记录，产生记录后会在这里展示。</p>
  <figure v-else-if="loaded" class="run-chart" aria-labelledby="run-chart-title">
    <figcaption><div><h4 id="run-chart-title">最近运行记录</h4><p>按任务类型汇总，最多显示最近 100 条。</p></div><div class="run-chart-total"><strong>{{jobs.length}}</strong><span>条记录</span></div></figcaption>
    <ul class="run-chart-legend" aria-label="运行状态汇总"><li v-for="state in legend" :key="state.id"><i :class="'run-state-'+state.id" aria-hidden="true"></i>{{state.label}} <strong>{{state.count}}</strong></li></ul>
    <ul class="run-chart-rows" aria-label="按任务类型统计">
      <li v-for="row in rows" :key="row.kind"><span class="run-chart-label">{{row.label}}</span><div class="run-chart-bar" role="img" :aria-label="row.description" :title="row.description"><template v-for="state in states" :key="state.id"><span v-if="row.counts[state.id]" :class="'run-state-'+state.id" :style="{width:row.counts[state.id]/axisMax*100+'%'}" aria-hidden="true"></span></template></div><span class="run-chart-count">{{row.total}}<span class="run-chart-sr-only"> 条</span></span></li>
    </ul>
    <div class="run-chart-axis" aria-hidden="true"><span v-for="tick in ticks" :key="tick">{{tick}}</span></div>
    <details v-if="errors.length" class="run-chart-errors"><summary>查看异常信息（{{errors.length}}）</summary><p v-for="job in errors" :key="job.id"><strong>{{kindOf(job)}} · {{stateLabel(job)}}</strong><span>{{job.error}}</span></p></details>
  </figure>
</template>
<style scoped>
.run-chart { margin:0 0 24px; }
.run-chart figcaption { display:flex; align-items:center; justify-content:space-between; gap:20px; }
.run-chart h4 { font-size:14px; font-weight:500; line-height:1.5; margin:0; color:var(--el-text-color-primary); }
.run-chart figcaption p { font-size:12px; color:var(--el-text-color-secondary); margin:6px 0 0; }
.run-chart-total { display:flex; align-items:baseline; gap:8px; white-space:nowrap; }
.run-chart-total strong { font-size:26px; font-weight:600; font-variant-numeric:tabular-nums; }
.run-chart-total > span { font-size:12px; color:var(--el-text-color-secondary); }
.run-chart-legend { display:flex; flex-wrap:wrap; gap:10px 20px; list-style:none; padding:0; margin:20px 0 24px; }
.run-chart-legend li { display:flex; align-items:center; gap:7px; font-size:12px; color:var(--el-text-color-secondary); }
.run-chart-legend strong { font-weight:500; font-variant-numeric:tabular-nums; color:var(--el-text-color-primary); }
.run-chart-legend i { width:8px; height:8px; border-radius:2px; }
.run-state-completed { background:var(--el-color-success); }
.run-state-running { background:var(--el-color-primary); }
.run-state-pending { background:var(--el-color-warning); }
.run-state-failed { background:var(--el-color-danger); }
.run-state-cancelled { background:var(--el-color-info); }
.run-state-other { background:var(--el-text-color-secondary); }
.run-chart-rows { list-style:none; margin:0; padding:0; display:grid; gap:18px; }
.run-chart-rows li { display:grid; grid-template-columns:86px minmax(0,1fr) 32px; align-items:center; gap:14px; }
.run-chart-label { font-size:13px; overflow-wrap:anywhere; }
.run-chart-bar { min-width:0; display:flex; height:22px; background:repeating-linear-gradient(to right,var(--el-border-color-extra-light) 0 1px,transparent 1px 25%); border-right:1px solid var(--el-border-color-extra-light); }
.run-chart-bar > span { flex:none; height:100%; }
.run-chart-count { text-align:right; font-size:13px; font-variant-numeric:tabular-nums; color:var(--el-text-color-secondary); }
.run-chart-axis { display:flex; justify-content:space-between; margin:12px 46px 0 100px; color:var(--el-text-color-secondary); font-size:11px; font-variant-numeric:tabular-nums; }
.run-chart-axis > span { width:0; display:flex; justify-content:center; white-space:nowrap; }
.run-chart-axis > span:first-child { justify-content:flex-start; }
.run-chart-axis > span:last-child { justify-content:flex-end; }
.run-chart-sr-only { position:absolute; width:1px; height:1px; overflow:hidden; clip-path:inset(50%); white-space:nowrap; }
.run-chart-message { font-size:13px; color:var(--el-text-color-secondary); margin:0 0 20px; }
.run-chart-errors { margin-top:24px; border-top:1px solid var(--el-border-color-extra-light); }
.run-chart-errors > summary { padding:14px 0; color:var(--el-text-color-secondary); cursor:pointer; font-size:13px; }
.run-chart-errors p { display:grid; gap:5px; margin:0; padding:10px 0; overflow-wrap:anywhere; font-size:13px; }
.run-chart-errors strong { font-weight:500; }
.run-chart-errors p > span { color:var(--el-text-color-secondary); }
.run-chart-errors > summary:focus-visible { outline:2px solid var(--el-color-primary); outline-offset:3px; }
@media(max-width:760px) {
  .run-chart figcaption { align-items:flex-start; gap:12px; }
  .run-chart-total { flex-direction:column; align-items:flex-end; gap:2px; }
  .run-chart-total strong { font-size:24px; }
  .run-chart-legend { gap:10px 16px; margin-block:18px 24px; }
  .run-chart-rows li { grid-template-columns:minmax(0,1fr) auto; gap:8px; }
  .run-chart-bar { grid-column:1/-1; grid-row:2; height:20px; }
  .run-chart-count { grid-column:2; grid-row:1; }
  .run-chart-axis { margin:12px 0 0; }
}
</style>
