import { localDate } from './stores/tasks';

export function dateTimeInZone(instant: Date, timezone: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(instant);
  const part = (name: string) => parts.find(item => item.type === name)!.value;
  return `${part('year')}-${part('month')}-${part('day')}T${part('hour')}:${part('minute')}`;
}

// datetime-local has no offset: resolve its wall time in the account's timezone.
export function dateTimeToISO(wallTime: string, timezone: string): string {
  const expected = Date.parse(wallTime + 'Z');
  if (!Number.isFinite(expected)) throw new Error('请选择有效的截止时刻。');
  let candidate = expected;
  for (let attempt = 0; attempt < 4; attempt++) {
    const displayed = Date.parse(dateTimeInZone(new Date(candidate), timezone) + 'Z');
    const delta = expected - displayed;
    if (delta === 0) return new Date(candidate).toISOString();
    candidate += delta;
  }
  throw new Error('该时刻在账户时区中不存在，请选择其他时间。');
}

export function defaultDeadline(timezone: string) {
  return { due_date: null, due_at: dateTimeToISO(localDate(timezone) + 'T23:59', timezone), due_timezone: timezone };
}
