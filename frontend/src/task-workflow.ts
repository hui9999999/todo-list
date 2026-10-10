import type { Status, Task, TaskWorkflow, WorkflowTask } from './types';

export const statusLabels: Record<Status, string> = {todo: '待办', doing: '进行中', done: '已完成', failed: '失败', cancelled: '已取消'};
export const statusHelp: Record<Status, string> = {
  todo: '尚未开始，可以开始处理，也可以直接完成。',
  doing: '正在处理，完成目标后标记为已完成。',
  done: '任务目标已达成；需要继续处理时可以重新打开。',
  failed: '本次执行未达到目标，请记录原因；之后可以重新尝试。',
  cancelled: '主动决定不再执行；计划改变时可以重新打开。',
};
export const failureReasons = ['未达到目标', '申请或审核未通过', '资源不足，无法完成', '执行出错'];
export function workflowFor(task: Task, tasks: Task[]): TaskWorkflow {
  if (task.workflow) return task.workflow;
  const descendants: Task[] = [], seen = new Set([task.id]), stack = [task.id];
  while (stack.length) {
    const parent = stack.pop();
    for (const child of tasks.filter(t => t.parent_id === parent && !t.deleted_at && !seen.has(t.id))) {
      seen.add(child.id); descendants.push(child); stack.push(child.id);
    }
  }
  const summary = (t: Task): WorkflowTask => ({id: t.id, title: t.title, status: t.status, version: t.version, fail_reason: t.fail_reason, deleted: Boolean(t.deleted_at)});
  return {blocking_dependencies: [], active_children: descendants.filter(t => ['todo', 'doing'].includes(t.status)).map(summary), failed_children: descendants.filter(t => t.status === 'failed').map(summary)};
}
export function dependencyMessage(task: WorkflowTask) {
  if (task.deleted) return `“${task.title}”已移入垃圾站，需恢复或解除依赖`;
  if (task.status === 'failed') return `“${task.title}”失败，需重试或解除依赖`;
  return `等待“${task.title}”完成`;
}
