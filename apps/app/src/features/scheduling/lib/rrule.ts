/**
 * Minimal RFC-5545 RRULE build/parse helpers for the blocked-time and
 * time-off dialogs. Only covers the subset the UI produces:
 * FREQ, INTERVAL, BYDAY, UNTIL, COUNT.
 */

export type RRuleFreq = 'DAILY' | 'WEEKLY' | 'MONTHLY';

/** RFC-5545 weekday codes indexed by JS getDay() (0=Sunday). */
export const BYDAY_CODES = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'] as const;

export interface RRuleParts {
  freq: RRuleFreq;
  interval: number;
  /** JS weekday numbers (0=Sunday..6=Saturday); only used when freq=WEEKLY. */
  byWeekdays: number[];
  /** Inclusive end of the series. Mutually exclusive with `count`. */
  until: Date | null;
  count: number | null;
}

/** Serialize a Date as an RFC-5545 UTC timestamp (YYYYMMDDTHHMMSSZ). */
function toRRuleUtc(date: Date): string {
  return `${date
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}/, '')}`;
}

/** Parse an RFC-5545 UTC timestamp back into a Date. */
function fromRRuleUtc(value: string): Date | null {
  const match = value.match(
    /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})Z?)?$/
  );
  if (!match) return null;
  const [, y, mo, d, h = '0', mi = '0', s = '0'] = match;
  return new Date(
    Date.UTC(
      Number(y),
      Number(mo) - 1,
      Number(d),
      Number(h),
      Number(mi),
      Number(s)
    )
  );
}

/** Build an RRULE body (no leading "RRULE:") from parts. */
export function buildRRule(parts: RRuleParts): string {
  const segments = [`FREQ=${parts.freq}`];
  if (parts.interval > 1) segments.push(`INTERVAL=${parts.interval}`);
  if (parts.freq === 'WEEKLY' && parts.byWeekdays.length > 0) {
    const days = [...parts.byWeekdays]
      .sort((a, b) => a - b)
      .map((d) => BYDAY_CODES[d])
      .join(',');
    segments.push(`BYDAY=${days}`);
  }
  if (parts.until) segments.push(`UNTIL=${toRRuleUtc(parts.until)}`);
  else if (parts.count && parts.count > 0)
    segments.push(`COUNT=${parts.count}`);
  return segments.join(';');
}

/** Parse an RRULE body (with or without leading "RRULE:") into parts. */
export function parseRRule(rrule: string): RRuleParts | null {
  const body = rrule.replace(/^RRULE:/i, '').trim();
  if (!body) return null;

  const parts: RRuleParts = {
    freq: 'WEEKLY',
    interval: 1,
    byWeekdays: [],
    until: null,
    count: null,
  };

  let hasFreq = false;
  for (const segment of body.split(';')) {
    const [rawKey, rawValue] = segment.split('=');
    if (!rawKey || rawValue === undefined) continue;
    const key = rawKey.toUpperCase();
    const value = rawValue.toUpperCase();
    if (key === 'FREQ') {
      if (value !== 'DAILY' && value !== 'WEEKLY' && value !== 'MONTHLY') {
        return null;
      }
      parts.freq = value;
      hasFreq = true;
    } else if (key === 'INTERVAL') {
      parts.interval = Math.max(1, Number.parseInt(value, 10) || 1);
    } else if (key === 'BYDAY') {
      parts.byWeekdays = value
        .split(',')
        .map((code) =>
          BYDAY_CODES.indexOf(code as (typeof BYDAY_CODES)[number])
        )
        .filter((d) => d >= 0);
    } else if (key === 'UNTIL') {
      parts.until = fromRRuleUtc(rawValue);
    } else if (key === 'COUNT') {
      parts.count = Number.parseInt(value, 10) || null;
    }
  }

  return hasFreq ? parts : null;
}
