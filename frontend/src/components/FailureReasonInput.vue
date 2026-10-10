<script setup lang="ts">
import { failureReasons } from '../task-workflow';
defineProps<{modelValue: string}>();
const emit = defineEmits<{'update:modelValue': [value: string]}>();
</script>
<template>
  <el-form-item label="失败原因" required>
    <div class="failure-reason-input">
      <div class="failure-reason-choices" aria-label="常用失败原因"><el-button v-for="reason in failureReasons" :key="reason" size="small" :type="modelValue === reason ? 'primary' : undefined" plain @click="emit('update:modelValue', reason)">{{ reason }}</el-button></div>
      <el-input :model-value="modelValue" @update:model-value="emit('update:modelValue', $event)" type="textarea" :rows="3" required aria-label="失败原因" :maxlength="10000" placeholder="选择常用原因，或填写本次未能完成的具体原因"/>
    </div>
  </el-form-item>
</template>
<style scoped>
.failure-reason-input { width: 100%; }
.failure-reason-choices { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 12px; }
.failure-reason-choices .el-button + .el-button { margin-left: 0; }
</style>
