import tzlookup from 'tz-lookup';

/**
 * Timezone helpers for availability math. No external library — uses `Intl`
 * (the same approach as the timesheets services). All availability timestamps
 * are stored as UTC instants (timestamptz); these helpers convert between a
 * business's wall-clock time and those instants for a given IANA time zone.
 *
 * `timezoneForLocation` at the bottom answers the prior question — WHICH zone a
 * business runs in — by deriving it from its primary location.
 */

/**
 * Offset of a UTC instant in a time zone, in milliseconds (local − UTC;
 * positive east of UTC). Uses `formatToParts` so it honours DST.
 */
function tzOffsetMs(instant: Date, timeZone: string): number {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  const parts = dtf.formatToParts(instant);
  const m: Record<string, number> = {};
  for (const p of parts) {
    if (p.type !== 'literal') m[p.type] = Number(p.value);
  }
  const asUtc = Date.UTC(
    m.year,
    m.month - 1,
    m.day,
    m.hour,
    m.minute,
    m.second
  );
  // Compare against the instant floored to whole seconds (asUtc has no ms).
  return asUtc - Math.floor(instant.getTime() / 1000) * 1000;
}

/**
 * Convert a wall-clock time (calendar date + minutes-from-midnight) in a time
 * zone to the corresponding UTC instant. E.g. 09:00 on 2026-07-06 in
 * "Europe/Dublin" (IST, UTC+1) → 2026-07-06T08:00:00Z.
 *
 * TWO offset corrections, not one. The naive approach — treat the wall clock
 * as UTC, look up the zone offset at THAT instant, subtract — reads the offset
 * on the wrong side of a DST boundary for any wall time within an hour of the
 * transition. Re-reading the offset at the corrected instant and, when it
 * disagrees, trusting the second reading fixes that.
 *
 * The visible consequence is the spring-forward gap. 01:30 on the morning the
 * clocks go forward in Dublin does not exist; one pass silently produced
 * 00:30Z (an hour that does, in the old offset), so a room recorded as open
 * 01:00–02:00 was credited a full hour of availability it could not have had.
 * Two passes collapse that interval to zero, which is the truth.
 *
 * WHAT IS STILL A CONVENTION, not a bug: the autumn hour that happens TWICE
 * resolves to its FIRST occurrence, so a 01:00–02:00 interval counts 60
 * minutes rather than 120. Counting it twice would need a policy decision
 * ("is a clinic open across the repeated hour open for two hours?") that no
 * caller has asked for. Every other hour of the year is exact.
 */
export function zonedWallTimeToUtc(
  dateStr: string,
  minutes: number,
  timeZone: string
): Date {
  const [y, mo, d] = dateStr.split('-').map(Number);
  const h = Math.floor(minutes / 60);
  const mi = minutes % 60;
  const guess = Date.UTC(y, mo - 1, d, h, mi, 0, 0);
  const firstOffset = tzOffsetMs(new Date(guess), timeZone);
  const candidate = guess - firstOffset;
  const secondOffset = tzOffsetMs(new Date(candidate), timeZone);
  // Agreement is the ordinary case — every wall time more than an hour from a
  // transition. Disagreement means the first reading came from the other side
  // of the boundary; the second was taken at an instant that is actually near
  // the answer, so it is the one to trust.
  return new Date(
    secondOffset === firstOffset ? candidate : guess - secondOffset
  );
}

/**
 * The wall-clock calendar date (YYYY-MM-DD) of a UTC instant in a time zone.
 * Use to match an instant against per-date opening-hours exceptions.
 */
export function zonedDateString(instant: Date, timeZone: string): string {
  // en-CA formats as YYYY-MM-DD.
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(instant);
}

/**
 * The wall-clock hour and minute of a UTC instant in a time zone. Use for
 * formatting/labelling offered slots in the business's own time zone.
 */
export function zonedHourMinute(
  instant: Date,
  timeZone: string
): { hour: number; minute: number } {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    hour: '2-digit',
    minute: '2-digit',
  });
  const m: Record<string, string> = {};
  for (const p of dtf.formatToParts(instant)) {
    if (p.type !== 'literal') m[p.type] = p.value;
  }
  return { hour: Number(m.hour), minute: Number(m.minute) };
}

// ---------------------------------------------------------------------------
// Formatting an instant for a HUMAN.
//
// Use these instead of calling `toLocale*String` directly. On the server the
// process zone is UTC, so an omitted `timeZone` is not a default — it is a
// silently wrong answer for every org outside UTC, and it looks entirely
// plausible. That defect has been found and fixed three separate times in this
// codebase (Claire's booking confirmations, the calendar's `?? 'UTC'`, and the
// appointment emails) because nothing made it unwriteable.
//
// `timeZone` is the FIRST argument and is required. There is no default and
// there should never be one: a call site that does not know which business it
// is talking about does not know enough to print a time.
// ---------------------------------------------------------------------------

/** An org timezone, or `'UTC'` when the org genuinely has none set. */
export type OrgTimeZone = string;

/**
 * Date + time in the business's zone, e.g. `"Friday, 14 August 2026 at 09:00"`.
 * For anything a customer or staff member will act on.
 */
export function formatInOrgZone(
  timeZone: OrgTimeZone,
  instant: Date,
  options: Intl.DateTimeFormatOptions = {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    hour: '2-digit',
    minute: '2-digit',
  },
  locale = 'en-GB'
): string {
  return instant.toLocaleString(locale, { ...options, timeZone });
}

/** Just the clock face in the business's zone, e.g. `"09:00"`. */
export function formatTimeInOrgZone(
  timeZone: OrgTimeZone,
  instant: Date,
  locale = 'en-GB'
): string {
  return instant.toLocaleTimeString(locale, {
    hour: '2-digit',
    minute: '2-digit',
    timeZone,
  });
}

/** Just the calendar date in the business's zone, e.g. `"Friday, 14 August 2026"`. */
export function formatDateInOrgZone(
  timeZone: OrgTimeZone,
  instant: Date,
  locale = 'en-GB'
): string {
  return instant.toLocaleDateString(locale, {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    timeZone,
  });
}

/**
 * The calendar day (`YYYY-MM-DD`) an instant falls on IN THE BUSINESS'S ZONE.
 *
 * Replaces `instant.toISOString().split('T')[0]`, which answers the question in
 * UTC. For a Californian org that idiom rolls the day over at 5pm local, so
 * usage counters, "last 7 days" windows and daily rollups attribute activity to
 * the wrong day — quietly, as numbers that don't reconcile rather than as an
 * obviously wrong clock face.
 */
export function orgDayString(timeZone: OrgTimeZone, instant: Date): string {
  // en-CA formats as YYYY-MM-DD.
  return instant.toLocaleDateString('en-CA', { timeZone });
}

// ---------------------------------------------------------------------------
// Resolving WHICH zone a business runs in.
//
// This restores the derivation added in `5cbd29d33` (June 2026) and lost when
// the fresha-clone work replaced the live lookup with the stored
// `organization.timezone` column (migration 0065). That column's only writer
// was a one-shot backfill, so every org created after 2026-07-18 sat on the
// `'UTC'` default — which the calendar, the booking form and Claire all read as
// the truth.
//
// Coordinates are exact and are always preferred. `createLocation` geocodes on
// write, so in practice almost every location has them.
//
// The country map below is a FALLBACK and it is a deliberate, known-imperfect
// trade — taken because the alternative is worse, not because it is right.
// `organization.timezone` is `NOT NULL DEFAULT 'UTC'`, so declining to guess
// does not leave the value unset, it leaves it on UTC. For a Californian clinic
// that is eight hours out; `America/New_York` is three. The fallback is the
// smaller error, and it only ever applies when geocoding has already failed.
//
// What it costs: for a multi-zone country the value is plausible-but-possibly-
// wrong, which is the failure mode that hid this whole bug for a month. Those
// rows are identifiable after the fact — a timezone that exactly equals its
// country's default on a location with no coordinates is a guess, not a
// measurement. See the FOLLOW-UP note in scripts/prod-backfill/README.md.
// ---------------------------------------------------------------------------

/**
 * Country → IANA fallback for locations that could not be geocoded.
 *
 * EXACT for single-zone countries (ie, gb, nz). A GUESS for the multi-zone ones
 * (us, ca, au) — `America/New_York` is merely the most populous US zone, not a
 * derivation. Do not read a value sourced from here as authoritative.
 */
const COUNTRY_TIMEZONE_FALLBACK: Record<string, string> = {
  ie: 'Europe/Dublin',
  gb: 'Europe/London',
  nz: 'Pacific/Auckland',
  us: 'America/New_York',
  ca: 'America/Toronto',
  au: 'Australia/Sydney',
};

/** Countries the fallback cannot resolve exactly — the value is a guess. */
export const MULTI_ZONE_COUNTRIES = new Set(['us', 'ca', 'au']);

export interface LocationLike {
  latitude?: number | null;
  longitude?: number | null;
  /** ISO 3166-1 alpha-2 (lowercase), as stored on organization_location. */
  country?: string | null;
}

/**
 * The IANA timezone for a location: exact from coordinates where possible, else
 * the country fallback. `null` only when there is neither — the caller then
 * leaves the column alone rather than inventing anything. Never throws.
 */
export function timezoneForLocation(loc?: LocationLike | null): string | null {
  if (
    loc?.latitude != null &&
    loc?.longitude != null &&
    Number.isFinite(loc.latitude) &&
    Number.isFinite(loc.longitude)
  ) {
    try {
      const tz = tzlookup(loc.latitude, loc.longitude);
      if (tz) return tz;
    } catch {
      // Out-of-range coordinates. Fall through to the country map.
    }
  }

  if (loc?.country) {
    const tz = COUNTRY_TIMEZONE_FALLBACK[loc.country.toLowerCase()];
    if (tz) return tz;
  }

  return null;
}
