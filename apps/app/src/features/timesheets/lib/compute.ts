import type {
  TimeEntryBreak,
  TimeEntryWithBreaks,
} from '@borradh-workspace/api-client/types';

const MS_PER_HOUR = 1000 * 60 * 60;

/**
 * Duration of a single break in milliseconds.
 * An in-progress break (breakEnd === null) is measured up to `now`.
 */
export function breakDurationMs(
  brk: Pick<TimeEntryBreak, 'breakStart' | 'breakEnd'>,
  now: number = Date.now()
): number {
  const start = new Date(brk.breakStart).getTime();
  const end = brk.breakEnd ? new Date(brk.breakEnd).getTime() : now;
  return Math.max(0, end - start);
}

/**
 * Total break time (ms) on an entry, with overlapping breaks merged so shared
 * time is counted once. Breaks are clipped to the entry window
 * (clock-in → clock-out, or `now` while still open), matching the backend pay
 * calculation (`calculate-overtime-pay` `breakMinutes`). Summing each break
 * independently over-subtracts worked time whenever an auto-break overlaps a
 * manual break.
 */
export function totalBreakMs(
  entry: TimeEntryWithBreaks,
  now: number = Date.now()
): number {
  const entryStart = new Date(entry.clockIn).getTime();
  const entryEnd = entry.clockOut ? new Date(entry.clockOut).getTime() : now;

  const intervals = (entry.breaks ?? [])
    .map((brk) => ({
      start: Math.max(new Date(brk.breakStart).getTime(), entryStart),
      end: Math.min(
        brk.breakEnd ? new Date(brk.breakEnd).getTime() : now,
        entryEnd
      ),
    }))
    .filter((b) => b.end > b.start)
    .sort((a, b) => a.start - b.start);

  let total = 0;
  let cursor = Number.NEGATIVE_INFINITY;
  for (const b of intervals) {
    const start = Math.max(b.start, cursor);
    if (b.end > start) {
      total += b.end - start;
      cursor = b.end;
    }
  }
  return total;
}

/**
 * Worked time (ms) for one entry = span from clock-in to clock-out
 * (or `now` when still open) minus all break time. Never negative.
 */
export function workedMs(
  entry: TimeEntryWithBreaks,
  now: number = Date.now()
): number {
  const start = new Date(entry.clockIn).getTime();
  const end = entry.clockOut ? new Date(entry.clockOut).getTime() : now;
  const span = Math.max(0, end - start);
  return Math.max(0, span - totalBreakMs(entry, now));
}

/** Convert milliseconds to decimal hours (e.g. 5_400_000 → 1.5). */
export function msToHours(ms: number): number {
  return ms / MS_PER_HOUR;
}

/** Format milliseconds as `Hh Mm` (e.g. `7h 30m`). */
export function formatDurationMs(ms: number): string {
  const totalMinutes = Math.round(ms / (1000 * 60));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours === 0) return `${minutes}m`;
  return `${hours}h ${minutes}m`;
}

/** Format decimal hours to two decimals (e.g. `7.50`). */
export function formatHours(hours: number): string {
  return hours.toFixed(2);
}
