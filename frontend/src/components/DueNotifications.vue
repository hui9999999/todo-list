<script setup lang="ts">
import {Bell, Close} from '@element-plus/icons-vue';
import type {Task} from '../types';
defineProps<{tasks: Task[]; timezone: string; preview?: boolean}>();
const emit=defineEmits<{open:[task:Task];dismiss:[id:string];clear:[]}>();
const priorities={high:'高优先级',mid:'中优先级',low:'低优先级'};
function deadline(task:Task, timezone:string){
  if(task.due_at)return new Intl.DateTimeFormat('zh-CN',{timeZone:timezone,month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit',hour12:false}).format(new Date(task.due_at));
  return task.due_date || '';
}
</script>
<template>
  <Transition name="due-reminder">
    <aside v-if="tasks.length" class="due-reminders" aria-label="到期任务提醒" aria-live="polite">
      <header><span class="due-reminders-icon"><el-icon><Bell/></el-icon></span><div><h2>{{preview?'提醒预览':'到期提醒'}}</h2><p>{{preview?'任务到期时，将这样提醒你':tasks.length+' 项待办需要关注'}}</p></div><button type="button" class="due-reminders-close" aria-label="关闭全部提醒" @click="emit('clear')"><el-icon><Close/></el-icon></button></header>
      <div class="due-reminders-list"><article v-for="task in tasks.slice(0,3)" :key="task.id" :class="'due-reminder-'+task.priority"><div class="due-reminder-meta"><span>{{priorities[task.priority]}}</span><time>截止 {{deadline(task,timezone)}}</time></div><h3>{{task.title}}</h3><div class="due-reminder-actions"><button type="button" @click="emit('open',task)">{{preview?'完成预览':'查看任务'}} <span aria-hidden="true">→</span></button><button type="button" @click="emit('dismiss',task.id)">知道了</button></div></article></div>
      <footer v-if="tasks.length>3">还有 {{tasks.length-3}} 项，处理上方提醒后继续查看。</footer>
    </aside>
  </Transition>
</template>
