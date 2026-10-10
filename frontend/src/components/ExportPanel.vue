<script setup lang="ts">
import { computed, onUnmounted, reactive, ref, watch } from 'vue';
import { Download } from '@element-plus/icons-vue';
import { ElMessage } from 'element-plus';
import { api, apiResponse } from '../api';
import { saveFile } from '../save-file';
import { localDate } from '../stores/tasks';
import { useAuth } from '../stores/auth';

const auth = useAuth();
const filters = reactive({ start: '', end: '', date_field: 'created', scope: 'all', status: 'all', include_trash: false, include_notes: true });
const format = ref('xlsx'), downloading = ref(false), loading = ref(false), error = ref('');
type Summary = { summary: { total: number; scopes: Record<string, number>; states: Record<string, number> }; description: string; selection: string; timezone: string };
const preview = ref<Summary | null>(null);
const scopes = [{ value: 'work', label: '工作' }, { value: 'life', label: '生活' }, { value: 'study', label: '学习' }, { value: 'unassigned', label: '未分类' }];
const states = [{ value: 'todo', label: '待办' }, { value: 'doing', label: '进行中' }, { value: 'done', label: '已完成' }, { value: 'failed', label: '失败' }, { value: 'cancelled', label: '已取消' }];
const dateError = computed(() => filters.start && filters.end && filters.start > filters.end ? '结束日期不能早于开始日期' : '');
const canDownload = computed(() => !loading.value && !downloading.value && !error.value && !dateError.value && !!preview.value);
const formatName = computed(() => ({ xlsx: 'Excel', pdf: 'PDF', docx: 'Word', csv: 'CSV' })[format.value]);
function parameters() {
  return new URLSearchParams(Object.entries(filters).filter(([, value]) => value !== '').map(([key, value]) => [key, String(value)])).toString();
}
function range(days: number | 'month' | 'all') {
  if (days === 'all') { filters.start = ''; filters.end = ''; return; }
  const today = localDate(auth.user?.timezone || 'Asia/Shanghai');
  filters.end = today;
  if (days === 'month') filters.start = today.slice(0, 8) + '01';
  else {
    const first = new Date(today + 'T12:00:00Z');
    first.setUTCDate(first.getUTCDate() - days + 1);
    filters.start = first.toISOString().slice(0, 10);
  }
}
let timer: ReturnType<typeof setTimeout> | undefined, request = 0;
watch(filters, () => {
  clearTimeout(timer);
  const current = ++request;
  error.value = ''; preview.value = null;
  if (dateError.value) { loading.value = false; return; }
  loading.value = true;
  timer = setTimeout(async () => {
    try {
      const result = await api<Summary>('/exports/preview?' + parameters());
      if (current === request) preview.value = result;
    } catch (e) {
      if (current === request) error.value = (e as Error).message;
    } finally { if (current === request) loading.value = false; }
  }, 180);
}, { immediate: true });
onUnmounted(() => { request++; clearTimeout(timer); });

async function download() {
  if (!canDownload.value) return;
  downloading.value = true;
  const chosen = format.value;
  try {
    const response = await apiResponse('/exports/report?' + parameters() + '&format=' + chosen, {}, true);
    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      throw new Error(typeof body.detail === 'string' ? body.detail : '导出失败，请重试');
    }
    await saveFile(await response.blob(), `todo-report-${localDate(auth.user?.timezone || 'Asia/Shanghai')}.${chosen}`);
    ElMessage.success('导出文件已生成');
  } catch (e) { ElMessage.error((e as Error).message); }
  finally { downloading.value = false; }
}
</script>

<template>
  <section class="data-section export-panel" aria-label="导出数据">
    <p class="page-description">选择范围与格式，导出任务明细和统计。时间按账户时区 {{ auth.user?.timezone || 'Asia/Shanghai' }} 计算。</p>
    <form @submit.prevent="download">
      <div class="export-range-buttons" role="group" aria-label="导出时间快捷选择">
        <el-button @click="range('all')">全部时间</el-button><el-button @click="range(7)">近 7 天</el-button><el-button @click="range(30)">近 30 天</el-button><el-button @click="range('month')">本月</el-button>
      </div>
      <div class="export-filter-grid">
        <label>时间依据<el-select v-model="filters.date_field" aria-label="导出时间依据"><el-option label="创建时间" value="created"/><el-option label="完成时间" value="completed"/><el-option label="更新时间" value="updated"/><el-option label="截止时间" value="due"/></el-select></label>
        <label>开始日期<input v-model="filters.start" type="date" aria-label="导出开始日期"/></label>
        <label>结束日期<input v-model="filters.end" type="date" aria-label="导出结束日期"/></label>
        <label>任务分类<el-select v-model="filters.scope" aria-label="导出任务分类"><el-option label="全部分类" value="all"/><el-option v-for="item in scopes" :key="item.value" :label="item.label" :value="item.value"/></el-select></label>
        <label>任务状态<el-select v-model="filters.status" aria-label="导出任务状态"><el-option label="全部状态" value="all"/><el-option v-for="item in states" :key="item.value" :label="item.label" :value="item.value"/></el-select></label>
        <label>文件格式<el-select v-model="format" aria-label="导出文件格式"><el-option label="Excel (.xlsx)" value="xlsx"/><el-option label="PDF (.pdf)" value="pdf"/><el-option label="Word (.docx)" value="docx"/><el-option label="CSV (.csv)" value="csv"/></el-select></label>
      </div>
      <div class="export-options"><el-checkbox v-model="filters.include_notes">包含任务备注</el-checkbox><el-checkbox v-model="filters.include_trash">包含垃圾站任务</el-checkbox></div>
      <details class="help-disclosure"><summary>日期与筛选说明</summary><p class="field-hint">不填日期表示不限。结束日期包含当天；按完成时间筛选时只计有完成时间的任务，按截止时间筛选时只计已设置截止的任务。导出包含隐藏任务。</p></details>
      <el-alert v-if="dateError || error" :title="dateError || error" type="error" :closable="false" role="alert"/>
      <div v-if="loading" class="export-preview" role="status">正在统计导出范围…</div>
      <div v-else-if="preview" class="export-preview" aria-label="导出范围预览">
        <div class="export-preview-heading"><span>符合条件的任务</span><strong>{{ preview.summary.total }} <small>条</small></strong></div>
        <div class="export-summary-charts">
          <div><h3>分类分布</h3><div v-for="item in scopes" :key="item.value" class="export-summary-row"><span>{{ item.label }}</span><div class="export-summary-track"><i :style="{width: (preview.summary.scopes[item.value] / Math.max(preview.summary.total, 1) * 100) + '%'}"></i></div><strong>{{ preview.summary.scopes[item.value] }}</strong></div></div>
          <div><h3>状态分布</h3><div v-for="item in states" :key="item.value" class="export-summary-row"><span>{{ item.label }}</span><div class="export-summary-track"><i :style="{width: (preview.summary.states[item.value] / Math.max(preview.summary.total, 1) * 100) + '%'}"></i></div><strong>{{ preview.summary.states[item.value] }}</strong></div></div>
        </div>
        <p v-if="!preview.summary.total" class="field-hint">没有符合条件的任务，可以调整筛选范围。</p>
      </div>
      <div class="action-row export-download"><el-button type="primary" :icon="Download" native-type="submit" :loading="downloading" :disabled="!canDownload">导出 {{ formatName }}</el-button><span class="field-hint">Excel 可筛选与分析；PDF 适合阅读；Word 可继续编辑。</span></div>
    </form>
  </section>
</template>
