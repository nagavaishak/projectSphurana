import type { TimeOff } from '@borradh-workspace/database';
import { expandRecurrence } from './expand-blocked-time.js';

/**
 * The only time-off fields needed to compute a busy interval. Narrower than
 * `TimeOff` on purpose: the public booking widget runs as `app_public`, which is
 * not granted `time_off.type` ('sick_leave') or `.description` — staff personal
 * data a busy interval never needs. A full `TimeOff` row still satisfies this.
 */
export type TimeOffBusySeries = Pick<
  TimeOff,
  'startDate' | 'endDate' | 'rrule' | 'timezone' | 'recurrenceEndDate'
>;

export interface TimeOffBusyRange {
  start: Date;
  end: Date;
}

/**
 * Expand a single time-off series into busy ranges within a window. Handles
 * one-off and recurring (RRULE) time off. Mirrors `expandBlockedTime` /
 * `expandUnavailability` but returns bare busy ranges — time off has no
 * per-occurrence exception table.
 *
 * Time off is treated as a hard busy block (the practitioner is unavailable);
 * `approved` filtering is the caller's responsibility.
 */
export function expandTimeOff(
  series: TimeOffBusySeries,
  windowStart: Date,
  windowEnd: Date
): TimeOffBusyRange[] {
  const results: TimeOffBusyRange[] = [];
  const duration = series.endDate.getTime() - series.startDate.getTime();

  if (!series.rrule) {
    if (series.startDate <= windowEnd && series.endDate >= windowStart) {
      results.push({ start: series.startDate, end: series.endDate });
    }
    return results;
  }

  for (const occStart of generateOccurrences(series, windowStart, windowEnd)) {
    results.push({
      start: occStart,
      end: new Date(occStart.getTime() + duration),
    });
  }

  return results;
}

/**
 * RRULE occurrence generator (subset: FREQ=DAILY/WEEKLY/MONTHLY/YEARLY,
 * INTERVAL, BYDAY, BYMONTHDAY, UNTIL, COUNT). Delegates to the shared
 * `expandRecurrence` so time-off, blocked-time and unavailability stay in step
 * (honours INTERVAL for all frequencies, counts COUNT from the series start,
 * and expands in the series' stored IANA time zone).
 */
function generateOccurrences(
  series: TimeOffBusySeries,
  windowStart: Date,
  windowEnd: Date
): Date[] {
  return expandRecurrence(
    series.rrule,
    series.startDate,
    series.timezone ?? 'UTC',
    windowStart,
    windowEnd
  );
}
