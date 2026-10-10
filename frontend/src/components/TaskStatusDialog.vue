<script setup lang="ts">
import { ref, watch } from 'vue';
import { ElMessage } from 'element-plus';
import type { TaskFields, WorkflowTask } from '../types';
import FailureReasonInput from './FailureReasonInput.vue';
const props = defineProps<{modelValue: boolean; mode: 'failure' | 'resolution'; title: string; fields: TaskFields; failedChildren: WorkflowTask[]; busy: boolean}>();
const emit = defineEmits<{'update:modelValue': [value: boolean]; save: [fields: TaskFields, review: Record<string, number> | undefined]}>();
const outcome = ref(props.fields.status), reason = ref('');
watch(() => props.modelValue, open => { if (open) { outcome.value = props.fields.status; reason.value = props.fields.fail_reason || ''; } }, {immediate: true});
function submit() {
  if (props.busy) return;
  if (outcome.value === 'failed' && !reason.value.trim()) { ElMessage.error('请填写失败原因'); return; }
  const review = outcome.value === 'done' ? Object.fromEntries(props.failedChildren.map(t => [t.id, t.version])) : undefined;
  emit('save', {...props.fields, status: outcome.value, fail_reason: outcome.value === 'failed' ? reason.value.trim() : ''}, review);
}
</script>
<template>
  <el-dialog :model-value="modelValue" :title="mode === 'failure' ? '标记任务失败' : '选择父任务结果'" width="min(480px, calc(100vw - 32px))" :close-on-click-modal="!busy" :close-on-press-escape="!busy" :show-close="!busy" @update:model-value="emit('update:modelValue', $event)">
    <p class="status-task-title">{{ title }}</p>
    <template v-if="mode === 'resolution'">
      <p>子任务均已结束，其中包含以下失败项。请根据整体目标选择父任务结果，子任务的实际结果会保留。</p>
      <ul class="failed-children"><li v-for="child in failedChildren" :key="child.id"><strong>{{ child.title }}</strong><p>{{ child.fail_reason || '历史记录未填写失败原因' }}</p></li></ul>
    </template>
    <el-form label-position="top" :disabled="busy" @submit.prevent="submit">
      <el-form-item v-if="mode === 'resolution'" label="父任务结果"><el-radio-group v-model="outcome" class="outcome-options"><el-radio value="done">整体目标已完成</el-radio><el-radio value="failed">整体未达成</el-radio><el-radio value="cancelled">不再执行</el-radio></el-radio-group></el-form-item>
      <FailureReasonInput v-if="outcome === 'failed'" v-model="reason"/>
      <p v-if="mode === 'resolution' && outcome === 'done'" class="field-hint">确认表示：虽然有失败子任务，父任务的整体目标仍已达成。</p>
      <p v-if="mode === 'failure'" class="field-hint">失败表示本次执行未达到目标；超过截止时间只算逾期。之后可以重新尝试，失败记录会保留。</p>
      <div class="editor-actions"><el-button type="primary" native-type="submit" :loading="busy">{{ mode === 'failure' ? '确认标记失败' : '确认结果' }}</el-button><el-button :disabled="busy" @click="emit('update:modelValue', false)">返回</el-button></div>
    </el-form>
  </el-dialog>
</template>
<style scoped>
.status-task-title { font-weight: 600; overflow-wrap: anywhere; }
.failed-children { padding-left: 20px; max-height: 220px; overflow: auto; }
.failed-children p { color: var(--el-text-color-secondary); white-space: pre-wrap; overflow-wrap: anywhere; margin: 4px 0 12px; }
.outcome-options { display: flex; flex-direction: column; align-items: flex-start; }
</style>
