/**
 * Times rendered in the CLINIC's timezone, never the browser's.
 *
 * apps/app builds a `TZDate` (`@date-fns/tz`) and hands it to date-fns
 * `format`. That package is not a dependency of marketing-astro, and adding one
 * to a `package.json` another agent is concurrently editing is not worth it for
 * formatting the platform already does — `Intl.DateTimeFormat` takes an IANA
 * `timeZone` directly.
 *
 * The distinction is load-bearing, not cosmetic: a customer on holiday in Spain
 * booking a Dublin clinic must see the DUBLIN time. Formatting in the local zone
 * shifts every time on the page by an hour and the customer arrives late.
 *
 * The output of each helper is pinned to the date-fns pattern it replaces, so
 * the ported screens read identically. Parts are assembled by hand rather than
 * trusted to a locale's ordering — `en-GB` renders "1 August 2026" where the
 * original pattern says "August 1, 2026".
 *
 * A null timezone means "the org didn't tell us" and falls back to the browser
 * zone, matching `zonedDate`'s behaviour in apps/app.
 */

const cache = new Map<string, Intl.DateTimeFormat>();

function formatter(
  timezone: string | null,
  options: Intl.DateTimeFormatOptions
): Intl.DateTimeFormat {
  const key = `${timezone ?? 'local'}|${JSON.stringify(options)}`;
  let existing = cache.get(key);
  if (!existing) {
    existing = new Intl.DateTimeFormat('en-US', {
      ...options,
      ...(timezone ? { timeZone: timezone } : {}),
    });
    cache.set(key, existing);
  }
  return existing;
}

type Part =
  | 'weekday'
  | 'day'
  | 'month'
  | 'year'
  | 'hour'
  | 'minute'
  | 'dayPeriod';

function pick(
  iso: string | Date,
  timezone: string | null,
  options: Intl.DateTimeFormatOptions
): Record<Part, string> {
  const parts = formatter(timezone, options).formatToParts(new Date(iso));
  const out = {} as Record<Part, string>;
  for (const part of parts) {
    out[part.type as Part] = part.value;
  }
  return out;
}

/** date-fns `EEEE, MMMM d, yyyy` — "Saturday, August 1, 2026". */
export function longDateInTz(iso: string | Date, timezone: string | null) {
  const p = pick(iso, timezone, {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });
  return `${p.weekday}, ${p.month} ${p.day}, ${p.year}`;
}

/** date-fns `EEEE, d MMMM yyyy` — "Saturday, 1 August 2026" (manage page). */
export function longDateDayFirstInTz(
  iso: string | Date,
  timezone: string | null
) {
  const p = pick(iso, timezone, {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });
  return `${p.weekday}, ${p.day} ${p.month} ${p.year}`;
}

/** date-fns `EEEE d MMMM` — "Saturday 1 August" (cart panel). */
export function weekdayDayMonthInTz(
  iso: string | Date,
  timezone: string | null
) {
  const p = pick(iso, timezone, {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  });
  return `${p.weekday} ${p.day} ${p.month}`;
}

/** date-fns `h:mm a` — "9:00 AM". */
export function time12InTz(iso: string | Date, timezone: string | null) {
  const p = pick(iso, timezone, {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });
  return `${p.hour}:${p.minute} ${p.dayPeriod}`;
}

/** date-fns `h:mm` — "9:00", no meridiem (start of a cart-panel range). */
export function time12NoMeridiemInTz(
  iso: string | Date,
  timezone: string | null
) {
  const p = pick(iso, timezone, {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });
  return `${p.hour}:${p.minute}`;
}

/** date-fns `HH:mm` — "14:30", 24h (manage page). */
export function time24InTz(iso: string | Date, timezone: string | null) {
  const p = pick(iso, timezone, {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  // `hourCycle` h23 renders midnight as "24" in some engines; normalise.
  const hour = p.hour === '24' ? '00' : p.hour;
  return `${hour}:${p.minute}`;
}

/** `2026-08-01` for a LOCAL `Date` the date strip produced — no zone shift. */
export function localDayKey(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}
