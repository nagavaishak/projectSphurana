import { TZDate } from '@date-fns/tz';

/**
 * Timezone helpers for the calendar. Every appointment/shift/block time is a
 * real UTC instant; these render and create times in the BUSINESS timezone
 * (organization.timezone) so they don't shift with the viewer's device
 * timezone.
 *
 * Built on `@date-fns/tz`'s `TZDate`: a `TZDate` created for an instant behaves,
 * under every date-fns operation (`format`, `getHours`, `differenceInMinutes`,
 * `isSameDay`, …), as that instant's wall-clock in its zone — DST included.
 */

/**
 * A `TZDate` view of an event's ISO time in the business zone. Pass the result
 * to date-fns functions to format/compare in the business timezone.
 */
export function zonedEvent(iso: string, timeZone: string): TZDate {
  return new TZDate(iso, timeZone);
}

/**
 * The UTC instant for a wall-clock time (a calendar day + chosen hour:minute)
 * in the business zone. Use when creating/moving an event so the picked time is
 * stored correctly regardless of the viewer's device timezone.
 */
export function zonedWallTimeToUtc(
  day: Date,
  hour: number,
  minute: number,
  timeZone: string
): Date {
  const zoned = new TZDate(
    day.getFullYear(),
    day.getMonth(),
    day.getDate(),
    hour,
    minute,
    0,
    0,
    timeZone
  );
  // Return a plain Date (the real UTC instant) for serialization.
  return new Date(zoned.getTime());
}

/**
 * The UTC instant at which a calendar day BEGINS in the business zone.
 *
 * `day` carries the intended calendar date in its LOCAL year/month/date — the
 * same convention `zonedWallTimeToUtc` and `format(day, 'yyyy-MM-dd')` already
 * use for the selected date. Only those three fields are read; the time of day
 * and the device's own zone are ignored.
 *
 * Use it to build the half-open window `[start, end)` a view covers. Composing
 * with `new Date(y, m, d)` arithmetic on the LOCAL date and converting once at
 * the end keeps month/year rollover and DST correct: a day is not always 24
 * hours long, so never derive the end by adding 24h to the start.
 *
 *   const start = zonedStartOfDayUtc(selectedDate, tz);
 *   const end   = zonedStartOfDayUtc(addDays(selectedDate, 1), tz);
 */
export function zonedStartOfDayUtc(day: Date, timeZone: string): Date {
  return zonedWallTimeToUtc(day, 0, 0, timeZone);
}

/** Wall-clock hour/minute of a UTC instant in the business zone. */
export function zonedHourMinute(
  instant: Date,
  timeZone: string
): { hour: number; minute: number } {
  const z = new TZDate(instant.getTime(), timeZone);
  return { hour: z.getHours(), minute: z.getMinutes() };
}

/** Minutes-from-midnight of a UTC instant in the business zone (grid positioning). */
export function zonedMinutesOfDay(instant: Date, timeZone: string): number {
  const z = new TZDate(instant.getTime(), timeZone);
  return z.getHours() * 60 + z.getMinutes();
}

/** The wall-clock calendar date (YYYY-MM-DD) of a UTC instant in the business zone. */
export function zonedDateString(instant: Date, timeZone: string): string {
  const z = new TZDate(instant.getTime(), timeZone);
  const mm = String(z.getMonth() + 1).padStart(2, '0');
  const dd = String(z.getDate()).padStart(2, '0');
  return `${z.getFullYear()}-${mm}-${dd}`;
}
