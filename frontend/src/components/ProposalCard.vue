<script setup lang="ts">
import type { Action, Proposal } from '../advanced-types';
import type { TaskFields } from '../types';
import { useAuth } from '../stores/auth';
import { dateTimeInZone } from '../task-deadline';
const auth = useAuth();
const props = withDefaults(defineProps<{proposal: Proposal; busy: boolean; showReason?: boolean}>(), {showReason:true});
defineEmits<{confirm: []; reject: []; undo: []}>();
const labels: Record<string,string> = {create:'创建任务', update:'修改任务', trash:'删除任务', plan:'加入安排'};
const fieldLabels: Partial<Record<keyof TaskFields, string>> = {title:'名称', scope:'分类', status:'状态', priority:'优先级', notes:'备注', estimated_minutes:'预计用时', fail_reason:'失败原因', hidden:'清单显示', parent_id:'父任务', project_id:'项目'};
const valueLabels: Record<string,string> = {work:'工作', life:'生活', study:'学习', unassigned:'未分类', todo:'待办', doing:'进行中', done:'已完成', failed:'失败', cancelled:'已取消', high:'高', mid:'中', low:'低'};
function title(action: Action) {return action.fields?.title || props.proposal.before.find(t => t.id === action.task_id)?.title || '任务';}
function actionLabel(action: Action) {return action.recurrence ? action.kind === 'create' ? '新建周期任务' : '设为周期任务' : labels[action.kind];}
function frequency(action: Action) {
  const rule = action.recurrence!;
  if (rule.interval === 1) return {daily:'每天', weekly:'每周', monthly:'每月'}[rule.frequency];
  return `每 ${rule.interval} ${{daily:'天', weekly:'周', monthly:'个月'}[rule.frequency]}`;
}
function value(key: keyof TaskFields, input: unknown) {
  if (input === null || input === undefined || input === '') return '未填写';
  if (key === 'hidden') return input ? '隐藏' : '显示';
  if (key === 'estimated_minutes') return `${input} 分钟`;
  return ['status', 'scope', 'priority'].includes(key) ? valueLabels[String(input)] || String(input) : String(input);
}
function deadline(fields: Partial<TaskFields>) {
  if (fields.due_date) return fields.due_date;
  if (fields.due_at) return dateTimeInZone(new Date(fields.due_at), fields.due_timezone || auth.user?.timezone || 'Asia/Shanghai').replace('T', ' ') + `（${fields.due_timezone || auth.user?.timezone || 'Asia/Shanghai'}）`;
  return '不设截止';
}
function changes(action: Action) {
  if (!action.fields) return [];
  const before = props.proposal.before.find(t => t.id === action.task_id);
  const rows: {label: string; before: string; after: string}[] = [];
  for (const key of Object.keys(fieldLabels) as (keyof TaskFields)[]) {
    if (!(key in action.fields)) continue;
    if (action.kind === 'create' && (key === 'title' || !action.fields[key])) continue;
    if (action.kind === 'update' && action.fields[key] === before?.[key]) continue;
    rows.push({label: fieldLabels[key]!, before: value(key, before?.[key]), after: value(key, action.fields[key])});
  }
  if (['due_date','due_at','due_timezone'].some(key => key in action.fields!)) {
    const oldValue = deadline(before || {}), newValue = deadline(action.fields);
    if (action.kind === 'create' || oldValue !== newValue) rows.push({label: '截止', before: oldValue, after: newValue});
  }
  return rows;
}
</script>
<template>
  <section class="proposal-card task-proposal" aria-label="任务操作预览">
    <h3>操作预览 <el-tag size="small">{{ proposal.state === 'pending' ? '等待确认' : proposal.state === 'accepted' ? '已执行' : '已结束' }}</el-tag></h3>
    <p v-if="showReason !== false" class="preserve-lines">{{ proposal.reason }}</p>
    <ul class="proposal-action-list"><li v-for="(action, index) in proposal.actions" :key="index">
      <div class="proposal-action-title"><span>{{ actionLabel(action) }}</span><strong>{{ title(action) }}</strong></div>
      <dl v-for="change in changes(action)" :key="change.label"><dt>{{ change.label }}</dt><dd><template v-if="action.kind === 'update'"><span class="proposal-old-value">{{ change.before }}</span> → </template><strong>{{ change.after }}</strong></dd></dl>
      <template v-if="action.recurrence"><dl><dt>重复周期</dt><dd><strong>{{ frequency(action) }}</strong></dd></dl><dl><dt>开始日期</dt><dd><strong>{{ action.recurrence.start_date }}</strong></dd></dl><dl><dt>生成方式</dt><dd><strong>{{ action.recurrence.mode === 'after_completion' ? '完成后间隔' : '固定日历周期' }}</strong></dd></dl><p class="field-hint">{{ action.kind === 'update' ? '保留当前任务，后续按周期生成独立任务。' : '按周期生成独立任务，每期按日期截止。' }}</p></template>
      <p v-if="action.kind === 'trash'" class="proposal-delete-note">移入垃圾站，可恢复。该任务的子任务也会一起移入。</p>
      <div v-if="action.confirmed_failed_children && Object.keys(action.confirmed_failed_children).length" class="proposal-delete-note"><p>子任务包含失败项。确认此提案表示父任务整体目标仍已完成，失败子任务的实际结果会保留：</p><ul><li v-for="id in Object.keys(action.confirmed_failed_children)" :key="id">{{ proposal.before.find(t => t.id === id)?.title }} · {{ proposal.before.find(t => t.id === id)?.fail_reason || '历史记录未填写失败原因' }}</li></ul></div>
      <p v-if="action.plan_date">安排日期：{{ action.plan_date }}</p>
    </li></ul>
    <p v-if="proposal.state === 'pending'" class="field-hint">确认后执行 {{ proposal.actions.length }} 项操作 · 有效至 {{ new Date(proposal.expires_at).toLocaleString() }}。</p>
    <div class="action-row" v-if="proposal.state === 'pending'"><el-button type="primary" :disabled="busy" @click="$emit('confirm')">确认这些变更</el-button><el-button :disabled="busy" @click="$emit('reject')">拒绝</el-button></div>
    <el-button v-if="proposal.state === 'accepted' && !proposal.undone" :disabled="busy" @click="$emit('undo')">撤销本次操作</el-button>
    <p v-if="proposal.undone" class="muted">本次操作已撤销。</p>
  </section>
</template>
