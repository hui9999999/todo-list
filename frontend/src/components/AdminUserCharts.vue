<script setup lang="ts">
import {computed} from 'vue';
import type {AdminUsageDetail} from '../admin-types';
import StatisticsChart from './StatisticsChart.vue';

const props=defineProps<{detail:AdminUsageDetail}>();
const number=(value:number)=>new Intl.NumberFormat('zh-CN').format(value);
const colors={input:'var(--stats-green)',output:'var(--stats-blue)',pending:'var(--stats-amber)',unknown:'var(--stats-gray)'};
const dayMs=86400000;
// Date-only arithmetic stays independent of the administrator's browser timezone.
const stamp=(date:string)=>Date.parse(date+'T00:00:00Z');
const iso=(value:number)=>new Date(value).toISOString().slice(0,10);
const span=computed(()=>Math.max(1,Math.round((stamp(props.detail.period.end)-stamp(props.detail.period.start))/dayMs)+1));
const bucketSize=computed(()=>span.value>120?Math.max(30,Math.ceil(span.value/60)):span.value>31?7:1);
const buckets=computed(()=>{
  const start=stamp(props.detail.period.start),size=bucketSize.value;
  const result=Array.from({length:Math.ceil(span.value/size)},(_,i)=>{
    const first=start+i*size*dayMs,last=Math.min(stamp(props.detail.period.end),first+(size-1)*dayMs);
    return {start:iso(first),end:iso(last),input:0,output:0};
  });
  for(const day of props.detail.daily){
    const index=Math.floor((stamp(day.date)-start)/(size*dayMs));
    if(result[index]){result[index].input+=day.input_tokens;result[index].output+=day.output_tokens;}
  }
  return result;
});
const labels=computed(()=>buckets.value.map(bucket=>bucket.start===bucket.end?bucket.start:bucket.start+' ～ '+bucket.end));
const axisLabels=computed(()=>buckets.value.map(bucket=>span.value>365?bucket.start.slice(0,7).replace('-','/'):bucket.start.slice(5).replace('-','/')));
const trend=computed(()=>[{label:'输入 Token',color:colors.input,values:buckets.value.map(row=>row.input)},
  {label:'输出 Token',color:colors.output,values:buckets.value.map(row=>row.output)}]);
const tokenParts=computed(()=>[{label:'输入 Token',value:props.detail.summary.input_tokens,color:colors.input},
  {label:'输出 Token',value:props.detail.summary.output_tokens,color:colors.output}]);
const percent=(value:number)=>props.detail.summary.reported_tokens?Math.round(value/props.detail.summary.reported_tokens*1000)/10:0;
const ring=computed(()=>{
  const split=percent(props.detail.summary.input_tokens);
  return props.detail.summary.reported_tokens?`conic-gradient(${colors.input} 0 ${split}%, ${colors.output} ${split}% 100%)`:'var(--stats-track)';
});
const models=computed(()=>[...props.detail.models].sort((a,b)=>b.reported_tokens-a.reported_tokens || a.model.localeCompare(b.model)));
const maxModel=computed(()=>Math.max(1,...models.value.map(row=>row.reported_tokens)));
const completeCalls=computed(()=>Math.max(0,props.detail.summary.calls-props.detail.summary.unreported_calls));
const incompleteCalls=computed(()=>Math.max(0,props.detail.summary.unreported_calls-props.detail.summary.pending_calls));
const callSeries=computed(()=>[{label:'调用次数',color:colors.input,values:[completeCalls.value,props.detail.summary.pending_calls,incompleteCalls.value]}]);
</script>

<template>
  <section class="admin-user-charts" aria-label="用户用量图表">
    <dl class="user-usage-metrics">
      <div><dt>已报告 Token</dt><dd>{{number(detail.summary.reported_tokens)}}</dd><small>输入 {{number(detail.summary.input_tokens)}} · 输出 {{number(detail.summary.output_tokens)}}</small></div>
      <div><dt>模型调用</dt><dd>{{number(detail.summary.calls)}}<small>次</small></dd><small>{{detail.period.start}} ～ {{detail.period.end}}</small></div>
      <div><dt>未报告完整用量</dt><dd>{{number(detail.summary.unreported_calls)}}<small>次</small></dd><small>含处理中 {{number(detail.summary.pending_calls)}} 次</small></div>
    </dl>
    <p class="usage-chart-note">图表统计所选日期内全部调用，按用户账户时区计算；未知 Token 不补算为实际消耗。</p>
    <div class="usage-chart-grid">
      <article class="usage-chart-card usage-chart-wide" aria-label="Token 趋势">
        <header><h3>Token 用量趋势</h3><p>{{bucketSize===1?'按日展示':`每 ${bucketSize} 天合计展示`}} · 空白日期记为 0</p></header>
        <StatisticsChart title="用户 Token 用量趋势图" :labels="labels" :axis-labels="axisLabels" :series="trend" type="line" unit="Token"/>
      </article>
      <article class="usage-chart-card" aria-label="输入输出占比">
        <header><h3>输入 / 输出占比</h3><p>仅统计厂商已报告的 Token</p></header>
        <div class="usage-token-split">
          <div class="usage-token-ring" :style="{background:ring}" role="img" :aria-label="`Token 占比：输入 ${number(detail.summary.input_tokens)}，输出 ${number(detail.summary.output_tokens)}`"><div><strong>{{number(detail.summary.reported_tokens)}}</strong><span>Token</span></div></div>
          <dl class="usage-token-legend"><div v-for="part in tokenParts" :key="part.label"><dt><i :style="{background:part.color}"/>{{part.label}}</dt><dd>{{number(part.value)}} <small>{{percent(part.value)}}%</small></dd></div></dl>
        </div>
        <p v-if="!detail.summary.reported_tokens" class="usage-chart-note">尚无已报告的 Token 用量。</p>
      </article>
      <article class="usage-chart-card" aria-label="模型用量分布">
        <header><h3>各模型 Token 用量</h3><p>按已报告用量排序</p></header>
        <div class="usage-model-legend"><span><i :style="{background:colors.input}"/>输入</span><span><i :style="{background:colors.output}"/>输出</span></div>
        <div v-if="models.length" class="usage-model-bars" role="group" aria-label="各模型 Token 用量图">
          <div v-for="model in models" :key="model.provider+':'+model.model" class="usage-model-row" role="img" :aria-label="`${model.provider} ${model.model}：输入 ${number(model.input_tokens)} Token，输出 ${number(model.output_tokens)} Token，调用 ${number(model.calls)} 次`" tabindex="0">
            <div class="usage-model-label"><strong>{{model.model}}</strong><span>{{model.provider}} · {{number(model.calls)}} 次</span></div>
            <div class="usage-model-track"><span :style="{width:model.input_tokens/maxModel*100+'%',background:colors.input}"/><span :style="{width:model.output_tokens/maxModel*100+'%',background:colors.output}"/></div>
            <div class="usage-model-value"><strong>{{number(model.reported_tokens)}}</strong><small>输入 {{number(model.input_tokens)}} / 输出 {{number(model.output_tokens)}}</small></div>
          </div>
        </div>
        <p v-else class="usage-chart-empty">暂无模型调用记录。</p>
      </article>
      <article class="usage-chart-card usage-chart-wide" aria-label="调用用量报告状态">
        <header><h3>调用用量报告状态</h3><p>已报告完整 {{number(completeCalls)}} 次 · 处理中 {{number(detail.summary.pending_calls)}} 次 · 其他未报告完整 {{number(incompleteCalls)}} 次</p></header>
        <StatisticsChart title="用户调用用量报告状态图" :labels="['已报告完整','处理中','其他未报告完整']" :series="callSeries" unit="次"/>
      </article>
    </div>
  </section>
</template>

<style scoped>
.admin-user-charts{--stats-green:#28715c;--stats-blue:#688fa8;--stats-amber:#b18b45;--stats-gray:#a1aaa5;--stats-track:#eaf0ec;--stats-hover:#edf3ef;min-width:0}.user-usage-metrics{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:20px;margin:24px 0}.user-usage-metrics>div{border-left:2px solid var(--el-border-color);padding-left:14px}.user-usage-metrics dt{font-size:12px;color:var(--el-text-color-secondary)}.user-usage-metrics dd{margin:8px 0;font-size:27px;font-weight:600;font-variant-numeric:tabular-nums;overflow-wrap:anywhere}.user-usage-metrics dd small{font-size:12px;font-weight:400;margin-left:6px}.user-usage-metrics>div>small,.usage-chart-note,.usage-chart-card header p{color:var(--el-text-color-secondary);font-size:12px;line-height:1.8}.usage-chart-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:20px;margin-top:22px}.usage-chart-wide{grid-column:1/-1}.usage-chart-card{min-width:0;padding:20px;border:1px solid var(--el-border-color);border-radius:8px;background:var(--el-bg-color)}.usage-chart-card header{margin-bottom:20px}.usage-chart-card h3{font-size:16px;font-weight:600;margin:0 0 6px}.usage-chart-card header p{margin:0}.usage-token-split{display:flex;align-items:center;gap:24px;flex-wrap:wrap}.usage-token-ring{width:154px;height:154px;border-radius:50%;padding:22px;box-sizing:border-box;flex:none}.usage-token-ring>div{width:100%;height:100%;border-radius:50%;background:var(--el-bg-color);display:flex;flex-direction:column;align-items:center;justify-content:center}.usage-token-ring strong{font-size:22px;font-variant-numeric:tabular-nums;overflow-wrap:anywhere;max-width:90%;text-align:center}.usage-token-ring span{font-size:11px;color:var(--el-text-color-secondary);margin-top:5px}.usage-token-legend{margin:0;display:grid;gap:20px;flex:1;min-width:110px}.usage-token-legend dt{font-size:12px;display:flex;gap:8px;align-items:center}.usage-token-legend dd{margin:7px 0 0;font-size:17px;font-variant-numeric:tabular-nums}.usage-token-legend small{font-size:12px;color:var(--el-text-color-secondary);margin-left:8px}.usage-token-legend i,.usage-model-legend i{width:8px;height:8px;border-radius:2px;display:inline-block;flex:none}.usage-model-legend{display:flex;gap:14px;font-size:12px;color:var(--el-text-color-secondary);margin-bottom:18px}.usage-model-legend span{display:flex;align-items:center;gap:6px}.usage-model-bars{display:grid;gap:18px;max-height:290px;overflow:auto;padding:2px}.usage-model-row{display:grid;gap:8px}.usage-model-label,.usage-model-value{display:flex;justify-content:space-between;align-items:baseline;gap:12px;flex-wrap:wrap}.usage-model-label strong{font-size:13px;font-weight:500;overflow-wrap:anywhere}.usage-model-label span,.usage-model-value small{font-size:11px;color:var(--el-text-color-secondary)}.usage-model-value strong{font-size:13px;font-weight:500;font-variant-numeric:tabular-nums}.usage-model-track{height:12px;background:var(--stats-track);border-radius:3px;overflow:hidden;display:flex}.usage-model-track span{height:100%}.usage-model-row:focus-visible{outline:2px solid var(--el-color-primary);outline-offset:2px;border-radius:3px}.usage-chart-empty{font-size:13px;color:var(--el-text-color-secondary);padding:24px 0}.usage-chart-card :deep(.chart-axis-text){font-size:11px}.usage-chart-card :deep(.statistics-chart-scroll){overflow:hidden}.usage-chart-card :deep(.chart-table-scroll){max-width:100%}:global(html[data-theme=dark]) .admin-user-charts{--stats-green:#7bb99c;--stats-blue:#8bb5cf;--stats-amber:#d5b36e;--stats-gray:#768c7e;--stats-track:#2d3d33;--stats-hover:#2b3e32}@media(max-width:640px){.user-usage-metrics{grid-template-columns:1fr;gap:16px}.user-usage-metrics dd{font-size:25px}.usage-chart-grid{grid-template-columns:1fr;gap:16px}.usage-chart-card{padding:16px}.usage-token-split{gap:18px}.usage-token-ring{width:138px;height:138px;padding:20px}.usage-token-ring strong{font-size:20px}.usage-token-legend{min-width:100px}.usage-token-legend dd{font-size:15px}}
</style>
