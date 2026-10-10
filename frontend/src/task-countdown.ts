import type { Task } from './types';
import { dateTimeToISO } from './task-deadline';

export function deadlineInstant(task: Pick<Task, 'due_at' | 'due_date' | 'due_timezone'>, timezone: string): number | null {
  if (task.due_at) {
    const instant = Date.parse(task.due_at);
    return Number.isFinite(instant) ? instant : null;
  }
  if (!task.due_date) return null;
  try {
    // A date-only deadline includes the whole day in its saved timezone.
    const nextDay = new Date(Date.parse(task.due_date + 'T00:00:00Z') + 86400000).toISOString().slice(0, 10);
    return Date.parse(dateTimeToISO(nextDay + 'T00:00', task.due_timezone || timezone));
  } catch { return null; }
}

function duration(milliseconds: number): string {
  const seconds = Math.floor(Math.abs(milliseconds) / 1000);
  const days = Math.floor(seconds / 86400);
  const clock = [Math.floor(seconds / 3600) % 24, Math.floor(seconds / 60) % 60, seconds % 60]
    .map(value => String(value).padStart(2, '0')).join(':');
  return (days ? days + '天 ' : '') + clock;
}

export function taskCountdown(status: Task['status'], deadline: number | null, now: number, trash = false) {
  if (trash) return {state: 'closed', label: '已移入垃圾站'};
  if (status === 'done') return {state: 'closed', label: '已完成'};
  if (status === 'failed') return {state: 'closed', label: '已失败'};
  if (status === 'cancelled') return {state: 'closed', label: '已取消'};
  if (deadline === null) return {state: 'none', label: '未设截止'};
  const remaining = deadline - now;
  if (remaining <= 0) return {state: 'overdue', label: '已逾期 ' + duration(remaining)};
  return {state: remaining <= 3600000 ? 'urgent' : 'upcoming', label: '剩余 ' + duration(remaining)};
}
