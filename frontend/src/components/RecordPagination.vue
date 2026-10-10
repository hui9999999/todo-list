<script setup lang="ts">
import {computed} from 'vue';
const props=defineProps<{page:number;total:number;pageSize:number;label:string;disabled?:boolean}>();
const emit=defineEmits<{change:[page:number]}>();
const pageCount=computed(()=>Math.max(1,Math.ceil(props.total/props.pageSize)));
</script>
<template>
  <nav v-if="total>0" class="record-pagination" :aria-label="label">
    <span role="status">共 {{total}} 条 · 第 {{page}} / {{pageCount}} 页</span>
    <div><el-button size="small" :disabled="disabled || page<=1" @click="emit('change',page-1)">上一页</el-button><el-button size="small" :disabled="disabled || page>=pageCount" @click="emit('change',page+1)">下一页</el-button></div>
  </nav>
</template>
<style scoped>
.record-pagination { display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:12px; margin-top:20px; padding-top:16px; border-top:1px solid var(--el-border-color-light); }
.record-pagination > span { color:var(--el-text-color-secondary); font-size:12px; font-variant-numeric:tabular-nums; }
.record-pagination > div { display:flex; gap:8px; }
.record-pagination :deep(.el-button + .el-button) { margin-left:0; }
</style>
