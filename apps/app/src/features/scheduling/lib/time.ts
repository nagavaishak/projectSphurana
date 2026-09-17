/**
 * Time helpers for the scheduling UI: 5-minute increment time options,
 * HH:mm <-> minutes-from-midnight conversion and duration formatting.
 */

/** Format minutes-from-midnight as HH:mm (24h). */
export function minutesToHHmm(minutes: number): string {
  const h = Math.floor(minutes / 60) % 24;
  const m = minutes % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/** Parse HH:mm into minutes-from-midnight. */
export function hhmmToMinutes(value: string): number {
  const [h, m] = value.split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
}

/** Format minutes-from-midnight for display, e.g. "9:05am", "5:30pm". */
export function formatMinutesLabel(minutes: number): string {
  const h24 = Math.floor(minutes / 60) % 24;
  const m = minutes % 60;
  const suffix = h24 < 12 ? 'am' : 'pm';
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  return `${h12}:${String(m).padStart(2, '0')}${suffix}`;
}

/** All times of day in 5-minute increments: 00:00 .. 23:55. */
export const TIME_OF_DAY_OPTIONS: { value: string; label: string }[] =
  Array.from({ length: (24 * 60) / 5 }, (_, i) => {
    const minutes = i * 5;
    return {
      value: minutesToHHmm(minutes),
      label: formatMinutesLabel(minutes),
    };
  });

/**
 * Duration options in 5-minute increments from 5min up to 8h55
 * (matches the blocked-time-type contract: multipleOf(5).min(5).max(535)).
 */
export const DURATION_OPTIONS: { value: number; label: string }[] = Array.from(
  { length: 535 / 5 },
  (_, i) => {
    const minutes = (i + 1) * 5;
    return { value: minutes, label: formatDurationMinutes(minutes) };
  }
);

/** Format a minute count as "45min", "1h", "1h 30min". */
export function formatDurationMinutes(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m}min`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}min`;
}

/**
 * Format a minute count in the roster's "hours" style, e.g. "0 min",
 * "45 min", "18 hr", "18 hr 30 min".
 */
export function formatHoursLabel(minutes: number): string {
  if (minutes <= 0) return '0 min';
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m} min`;
  if (m === 0) return `${h} hr`;
  return `${h} hr ${m} min`;
}

/** Combine a yyyy-MM-dd date string and HH:mm time string into a local Date. */
export function combineDateTime(date: string, time: string): Date {
  const [h, m] = time.split(':').map(Number);
  const result = new Date(`${date}T00:00:00`);
  result.setHours(h || 0, m || 0, 0, 0);
  return result;
}

/** Snap an HH:mm value to the nearest 5-minute increment. */
export function snapToFiveMinutes(time: string): string {
  const minutes = hhmmToMinutes(time);
  const snapped = Math.round(minutes / 5) * 5;
  return minutesToHHmm(Math.min(snapped, 23 * 60 + 55));
}
