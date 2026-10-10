<script setup lang="ts">
import { computed, ref } from 'vue';
import { CircleCheck, Plus, Minus, ArrowDown, MoreFilled, Timer } from "@element-plus/icons-vue";
import { deadlineInstant, taskCountdown } from '../task-countdown';
import { useTaskClock } from '../task-clock';
import type { Task, Status, TaskWorkflow } from "../types";
import { dependencyMessage } from '../task-workflow';
const props = defineProps<{
  task: Task;
  depth: number;
  busy: boolean;
  planned: boolean;
  trash: boolean;
  timezone: string;
  workflow?: TaskWorkflow;
}>();
const emit = defineEmits<{
  edit: [task: Task];
  toggle: [task: Task];
  status: [task: Task, status: Status];
  child: [task: Task];
  plan: [task: Task];
  trash: [task: Task];
  restore: [task: Task];
  purge: [task: Task];
}>();
const scopes = { work: "工作", life: "生活", study: "学习", unassigned: "未分类" };
const priorities = {high: '高优先级', mid: '中优先级', low: '低优先级'};
const detailsPinned = ref(false), hovered = ref(false), keyboardFocus = ref(false);
const detailsVisible = computed(() => detailsPinned.value || hovered.value || keyboardFocus.value);
const now = useTaskClock();
const deadline = computed(() => deadlineInstant(props.task, props.timezone));
const countdown = computed(() => taskCountdown(props.task.status, deadline.value, now.value, props.trash));
const statuses = {
  todo: "待办",
  doing: "进行中",
  done: "已完成",
  failed: "失败",
  cancelled: "已取消",
};
const blockers = computed(() => props.workflow?.blocking_dependencies || props.task.workflow?.blocking_dependencies || []);
const active = computed(() => ['todo', 'doing'].includes(props.task.status));
function dueLabel(task: Task, zone: string) {
  return (
    task.due_date ||
    (task.due_at
      ? new Intl.DateTimeFormat("zh-CN", {
          timeZone: zone,
          year: 'numeric',
          month: "2-digit",
          day: "2-digit",
          hour: "2-digit",
          minute: "2-digit",
        }).format(new Date(task.due_at))
      : "")
  );
}
function command(action: string, task: Task) {
  if (action === "child") emit("child", task);
  else if (action === "trash") emit("trash", task);
  else if (action === "plan") emit("plan", task);
  else if (action === 'failed' || action === 'cancelled') emit('status', task, action);
}
function open() { if (!props.busy) emit('edit', props.task); }
function pointerEnter(event: PointerEvent) {
  if (event.pointerType === 'mouse' && window.matchMedia('(hover: hover)').matches) hovered.value = true;
}
function focusIn(event: FocusEvent) { keyboardFocus.value = (event.target as HTMLElement).matches(':focus-visible'); }
function focusOut(event: FocusEvent) {
  if (!(event.currentTarget as HTMLElement).contains(event.relatedTarget as Node | null)) keyboardFocus.value = false;
}
function toggleDetails() { detailsPinned.value = !detailsPinned.value; keyboardFocus.value = false; }
</script>
<template>
  <article
    class="task-row task-card"
    :class="['priority-' + task.priority, { completed: task.status === 'done', child: depth > 0, 'task-card-trash': trash, 'details-visible': detailsVisible }]"
    :style="{ '--depth': Math.min(depth, 3) }"
    :data-task-id="task.id"
    :aria-label="task.title"
    @click="open"
    @pointerenter="pointerEnter"
    @pointerleave="hovered = false"
    @focusin="focusIn"
    @focusout="focusOut"
  >
    <header class="task-card-heading">
    <button
      v-if="!trash && ['todo','doing','done'].includes(task.status)"
      class="task-check"
      :class="{ checked: task.status === 'done' }"
      :disabled="busy"
      :aria-label="
        (task.status === 'done' ? '重新打开：' : '完成：') + task.title
      "
      @click.stop="emit('toggle', task)"
    >
      <el-icon v-if="task.status === 'done'"><CircleCheck /></el-icon>
    </button>
      <button class="task-title" :disabled="busy" @click.stop="open">
        {{ task.title }}
      </button>
      <button class="task-details-button" type="button" :aria-label="(detailsPinned ? '收起任务信息：' : '展开任务信息：') + task.title" :aria-expanded="detailsVisible" :aria-controls="'task-details-' + task.id" @click.stop="toggleDetails"><el-icon><ArrowDown /></el-icon></button>
      <el-dropdown v-if="!trash" trigger="click" :disabled="busy" @command="command($event, task)">
        <el-button class="more-button" text aria-label="任务更多操作" :disabled="busy" @click.stop><el-icon><MoreFilled /></el-icon></el-button>
        <template #dropdown><el-dropdown-menu>
          <el-dropdown-item command="child" :icon="Plus" :disabled="!active">添加子任务</el-dropdown-item>
          <el-dropdown-item command="plan">{{ planned ? '移出今日' : '加入今日' }}</el-dropdown-item>
          <el-dropdown-item v-if="active" command="failed" divided>标记失败</el-dropdown-item>
          <el-dropdown-item v-if="active" command="cancelled">取消任务</el-dropdown-item>
          <el-dropdown-item command="trash" divided>移入垃圾站（含子任务）</el-dropdown-item>
        </el-dropdown-menu></template>
      </el-dropdown>
    </header>
    <div class="task-body">
      <div class="task-meta">
        <span class="task-priority">{{ priorities[task.priority] }}</span>
        <span v-if="depth > 0" class="task-child-label">子任务</span>
        <span v-if="task.scope!=='unassigned'" :class="'scope-' + task.scope">{{ scopes[task.scope] }}</span
        ><span v-if="task.hidden">已隐藏</span
        ><span v-if="task.status !== 'todo'">{{ statuses[task.status] }}</span
        ><span v-if="task.status === 'done' && !task.completed_at"
          >完成日期未知</span
        >
      </div>
      <div v-if="!trash && active && blockers.length" class="task-blocked" role="status"><strong>受阻</strong><p v-for="dependency in blockers" :key="dependency.id">{{ dependencyMessage(dependency) }}</p></div>
    </div>
    <footer class="task-card-footer">
      <div class="task-card-time">
        <div class="task-countdown" :class="'countdown-' + countdown.state"><el-icon><Timer /></el-icon><span>{{ countdown.label }}</span></div>
      </div>
      <div v-if="trash" class="task-card-actions" @click.stop><el-button text type="danger" size="small" :disabled="busy" @click="emit('purge',task)">永久删除</el-button><el-button size="small" :disabled="busy" @click="emit('restore', task)">恢复</el-button></div>
      <div v-else class="task-card-actions" @click.stop>
      <el-button v-if="task.status === 'todo'" size="small" :disabled="busy || blockers.length > 0" @click="emit('status', task, 'doing')">开始</el-button>
      <el-button v-if="active" text size="small" :disabled="busy" @click="emit('toggle', task)">完成</el-button>
      <el-button v-if="task.status === 'failed'" size="small" :disabled="busy" @click="emit('status', task, 'todo')">重新尝试</el-button>
      <el-button v-if="task.status === 'done' || task.status === 'cancelled'" text size="small" :disabled="busy" @click="emit('status', task, 'todo')">重新打开</el-button>
      <el-tooltip :content="planned ? '移出今日' : '加入今日'" placement="top">
      <el-button
        class="plan-button"
        :class="{planned}"
        text
        size="small"
        :disabled="busy"
        :aria-label="planned ? '移出今日' : '加入今日'"
        @click.stop="emit('plan', task)"
        ><el-icon><component :is="planned ? Minus : Plus" /></el-icon></el-button
      >
      </el-tooltip>
      </div>
    </footer>
    <div :id="'task-details-' + task.id" class="task-card-details" :aria-hidden="!detailsVisible" :inert="!detailsVisible">
      <div class="task-card-details-inner">
        <div class="task-card-facts"><span>状态：{{ statuses[task.status] }}</span><span v-if="task.estimated_minutes != null">预计 {{ task.estimated_minutes }} 分钟</span><span v-if="task.due_date || task.due_at" class="task-card-deadline">截止 {{ dueLabel(task, timezone) }}</span><span v-else>未设置截止时间</span></div>
        <p v-if="task.notes.trim()" class="task-card-notes">{{ task.notes }}</p>
        <p v-if="task.status === 'failed' && task.fail_reason" class="task-card-failure">失败原因：{{ task.fail_reason }}</p>
      </div>
    </div>
  </article>
</template>
