// Account time-zone selector options. Values stay IANA IDs (the backend validates
// them with ZoneInfo); labels come from the bundled Chinese name table generated
// by scripts/generate-timezone-names.py. Asia/Shanghai stays first as the default.
import { timezoneNames, timezoneSearchAliases } from './timezone-names';

export const defaultTimezone = 'Asia/Shanghai';

export interface TimezoneOption { id: string; label: string; search: string }

const fallbackIds = ['UTC', 'Asia/Shanghai', 'Asia/Hong_Kong', 'Asia/Taipei', 'Asia/Macau',
  'Asia/Singapore', 'Asia/Tokyo', 'Asia/Seoul', 'Asia/Bangkok', 'Asia/Kolkata',
  'Asia/Dubai', 'Europe/London', 'Europe/Paris', 'Europe/Berlin', 'Europe/Moscow',
  'America/New_York', 'America/Chicago', 'America/Denver', 'America/Los_Angeles',
  'America/Sao_Paulo', 'America/Vancouver', 'Australia/Sydney', 'Pacific/Auckland'];

function zoneIds(): string[] {
  try {
    const zones: readonly string[] = Intl.supportedValuesOf('timeZone');
    return zones.length
      ? Array.from(new Set([defaultTimezone, ...zones])).sort((a, b) => a === defaultTimezone ? -1 : b === defaultTimezone ? 1 : a.localeCompare(b))
      : fallbackIds;
  } catch { return fallbackIds; }
}

export const timezoneOptions: TimezoneOption[] = zoneIds().map(id => ({
  id,
  label: timezoneNames[id] || id,
  search: `${timezoneNames[id] || ''}\n${timezoneSearchAliases[id] || ''}\n${id}`.toLowerCase(),
}));
