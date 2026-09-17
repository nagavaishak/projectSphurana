/**
 * Times rendered in the CLINIC's timezone, never the browser's.
 *
 * apps/app used `TZDate` from `@date-fns/tz`. That package is not a dependency
 * of marketing-astro and adding one to a package.json another agent is
 * concurrently editing is not worth it for date formatting the platform
 * already does: `Intl.DateTimeFormat` takes an IANA `timeZone` directly.
 *
 * The distinction matters and is not cosmetic. A customer on holiday in Spain
 * opening a portal for a clinic in Dublin must see the Dublin time of their
 * appointment. Formatting in the local zone silently shifts every time on the
 * page by an hour and the customer arrives late.
 */

const cache = new Map<string, Intl.DateTimeFormat>();

function formatter(
  timezone: string,
  options: Intl.DateTimeFormatOptions
): Intl.DateTimeFormat {
  const key = `${timezone}|${JSON.stringify(options)}`;
  let existing = cache.get(key);
  if (!existing) {
    existing = new Intl.DateTimeFormat('en-GB', {
      ...options,
      timeZone: timezone,
    });
    cache.set(key, existing);
  }
  return existing;
}

/** `2026-03-09` in the clinic's zone — the key relative-day math compares on. */
export function dayKeyInTz(iso: string | Date, timezone: string): string {
  const parts = formatter(timezone, {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date(iso));
  const get = (type: string) =>
    parts.find((part) => part.type === type)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

/** `14:30` — 24h, matching the original `format(…, 'HH:mm')`. */
export function timeInTz(iso: string | Date, timezone: string): string {
  return formatter(timezone, {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date(iso));
}

/** `2:30 pm` — the 12h form the slot pills use. */
export function time12InTz(iso: string | Date, timezone: string): string {
  return formatter(timezone, {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  })
    .format(new Date(iso))
    .toLowerCase();
}

/** `Monday, 9 March 2026`. */
export function longDateInTz(iso: string | Date, timezone: string): string {
  return formatter(timezone, {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).format(new Date(iso));
}

/**
 * `Mon 9 Mar 2026`.
 *
 * en-GB inserts a comma after a short weekday once a year is present
 * ("Sat, 14 Mar 2026"); the original date-fns pattern (`EEE d MMM yyyy`) did
 * not. Dropped so the card labels are unchanged by the move.
 */
export function shortDateInTz(iso: string | Date, timezone: string): string {
  return formatter(timezone, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  })
    .format(new Date(iso))
    .replace(',', '');
}

/** `Mon 9 Mar, 14:30` — the cancel-deadline / confirm-button form. */
export function shortDateTimeInTz(
  iso: string | Date,
  timezone: string
): string {
  return `${formatter(timezone, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  }).format(new Date(iso))}, ${timeInTz(iso, timezone)}`;
}

/**
 * "Today" / "Tomorrow" / `Mon 9 Mar 2026`, decided in the CLINIC's zone.
 *
 * `now` is injectable so the boundary is testable — "is 23:30 tonight still
 * today?" depends entirely on which zone you ask in, and that is exactly the
 * case worth pinning.
 */
export function relativeDayLabel(
  startTime: string,
  timezone: string,
  now: Date = new Date()
): string {
  const day = dayKeyInTz(startTime, timezone);
  if (day === dayKeyInTz(now, timezone)) return 'Today';
  const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000);
  if (day === dayKeyInTz(tomorrow, timezone)) return 'Tomorrow';
  return shortDateInTz(startTime, timezone);
}

/** `2026-03-09` for a local `Date` the calendar produced — no zone shift. */
export function localDayKey(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}
