import {test,expect} from '@playwright/test';
import {deadlineInstant,taskCountdown} from '../src/task-countdown';

test('纯日期按保存时区的日末计算，支持夏令时和无截止日期',()=>{
  expect(deadlineInstant({due_at:null,due_date:'2026-10-02',due_timezone:'Asia/Shanghai'},'UTC')).toBe(Date.parse('2026-10-02T16:00:00Z'));
  const end=deadlineInstant({due_at:null,due_date:'2026-03-29',due_timezone:'Europe/Berlin'},'UTC');
  expect(end).toBe(Date.parse('2026-03-29T22:00:00Z'));
  expect(end! - Date.parse('2026-03-28T23:00:00Z')).toBe(23*3600000);
  expect(deadlineInstant({due_at:'2026-10-02T03:30:00+08:00',due_date:null,due_timezone:'UTC'},'UTC')).toBe(Date.parse('2026-10-01T19:30:00Z'));
  expect(deadlineInstant({due_at:null,due_date:null,due_timezone:null},'Asia/Shanghai')).toBeNull();
});

test('倒计时跨日、到期、逾期和结束状态',()=>{
  const now=Date.parse('2026-10-02T02:00:00Z');
  expect(taskCountdown('todo',now+3*86400000+3661000,now)).toEqual({state:'upcoming',label:'剩余 3天 01:01:01'});
  expect(taskCountdown('doing',now+1000,now)).toEqual({state:'urgent',label:'剩余 00:00:01'});
  expect(taskCountdown('todo',now,now)).toEqual({state:'overdue',label:'已逾期 00:00:00'});
  expect(taskCountdown('todo',now-86400000-1000,now)).toEqual({state:'overdue',label:'已逾期 1天 00:00:01'});
  expect(taskCountdown('todo',null,now).label).toBe('未设截止');
  expect(taskCountdown('done',now-1000,now).label).toBe('已完成');
  expect(taskCountdown('failed',now-1000,now).label).toBe('已失败');
  expect(taskCountdown('cancelled',now-1000,now).label).toBe('已取消');
  expect(taskCountdown('todo',now-1000,now,true).label).toBe('已移入垃圾站');
});
