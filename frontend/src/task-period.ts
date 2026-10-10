import type {Task} from './types';
import {dateTimeInZone} from './task-deadline';

export const checklistPeriods = [
  {id:'today', title:'今日清单'},
  {id:'week', title:'本周清单'},
  {id:'month', title:'本月清单'},
  {id:'year', title:'年度清单'},
] as const;
export type ChecklistPeriod = typeof checklistPeriods[number]['id'];
export function checklistPeriod(value: unknown): ChecklistPeriod {
  return checklistPeriods.find(period=>period.id===value)?.id || 'today';
}
const iso=(date:Date)=>date.toISOString().slice(0,10);
export function checklistRange(period:ChecklistPeriod, day:string) {
  const date=new Date(day+'T00:00:00Z');
  if(period==='week'){
    date.setUTCDate(date.getUTCDate()-(date.getUTCDay()+6)%7);
    const start=iso(date);date.setUTCDate(date.getUTCDate()+6);
    return {start,end:iso(date)};
  }
  if(period==='month')return {start:day.slice(0,7)+'-01',end:iso(new Date(Date.UTC(date.getUTCFullYear(),date.getUTCMonth()+1,0)))};
  if(period==='year')return {start:day.slice(0,4)+'-01-01',end:day.slice(0,4)+'-12-31'};
  return {start:day,end:day};
}
export function taskDeadlineDate(task:Task, timezone:string) {
  return task.due_date || (task.due_at ? dateTimeInZone(new Date(task.due_at),timezone).slice(0,10) : null);
}
export function inChecklist(task:Task, range:{start:string;end:string}, timezone:string, planned:Set<string>) {
  if(planned.has(task.id))return true;
  const date=taskDeadlineDate(task,timezone);
  return Boolean(date && (date>=range.start && date<=range.end || date<range.start && ['todo','doing'].includes(task.status)));
}
