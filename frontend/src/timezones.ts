// IANA time zones for the account settings selector, newest browsers provide the
// full list; older ones fall back to a curated set. Asia/Shanghai stays on top
// as the default account time zone.
export const defaultTimezone = 'Asia/Shanghai';

const fallback = ['UTC', 'Asia/Shanghai', 'Asia/Hong_Kong', 'Asia/Taipei', 'Asia/Macau',
  'Asia/Singapore', 'Asia/Tokyo', 'Asia/Seoul', 'Asia/Bangkok', 'Asia/Kolkata',
  'Asia/Dubai', 'Europe/London', 'Europe/Paris', 'Europe/Berlin', 'Europe/Moscow',
  'America/New_York', 'America/Chicago', 'America/Denver', 'America/Los_Angeles',
  'America/Sao_Paulo', 'America/Vancouver', 'Australia/Sydney', 'Pacific/Auckland'];

export const timezoneOptions: string[] = (() => {
  try {
    const zones: readonly string[] = Intl.supportedValuesOf('timeZone');
    return zones.length ? Array.from(new Set([defaultTimezone, ...zones])) : fallback;
  } catch { return fallback; }
})();
