import type { VenueConfig } from '@borradh-workspace/contracts';
import { TZDate } from '@date-fns/tz';

/**
 * Opening-hours helpers for the public venue page.
 *
 * The API gives a weekly map keyed by day-of-week (0=Sun … 6=Sat) → `{ from, to }`
 * minutes-from-midnight, plus the org's IANA timezone. Everything here is
 * computed in THAT timezone, never the browser's — a visitor in New York must
 * still see the Dublin salon's clock, otherwise "opens at 10:00" is an hour out.
 */

export type OpeningHoursMap = NonNullable<
  VenueConfig['location']['openingHours']
>;
export type DayHours = OpeningHoursMap[string];

const DAY_NAMES = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
] as const;

/** Format minutes-from-midnight as "10:00 am" (Fresha-style lowercase meridiem). */
export function formatMinutes(minutes: number): string {
  const h24 = Math.floor(minutes / 60);
  const m = minutes % 60;
  const meridiem = h24 < 12 ? 'am' : 'pm';
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  return `${h12}:${m.toString().padStart(2, '0')} ${meridiem}`;
}

export interface VenueStatus {
  /** True when the venue is open at `now` in its own timezone. */
  isOpen: boolean;
  /**
   * Short human status, e.g. "Open until 7:30 pm",
   * "Closed - opens on Wednesday at 10:00 am", or "Closed".
   */
  label: string;
}

function dayHours(hours: OpeningHoursMap, day: number): DayHours | undefined {
  return hours[String(day)];
}

/**
 * Compute the venue's open/closed status in its own timezone.
 *
 * `now` is injectable so the (test-visible) behaviour is deterministic; in the
 * app it defaults to the real current instant, reinterpreted in `timezone`.
 */
export function computeVenueStatus(
  openingHours: OpeningHoursMap | null | undefined,
  timezone: string,
  now: Date = new Date()
): VenueStatus {
  if (!openingHours || Object.keys(openingHours).length === 0) {
    return { isOpen: false, label: 'Hours not available' };
  }

  const local = new TZDate(now.getTime(), timezone);
  const today = local.getDay();
  const nowMinutes = local.getHours() * 60 + local.getMinutes();

  const todayHours = dayHours(openingHours, today);
  if (
    todayHours &&
    nowMinutes >= todayHours.from &&
    nowMinutes < todayHours.to
  ) {
    return {
      isOpen: true,
      label: `Open until ${formatMinutes(todayHours.to)}`,
    };
  }

  // Not open right now — find the next opening within the coming week.
  // Later today first (venue opens again after the current instant), then the
  // following days in order.
  if (todayHours && nowMinutes < todayHours.from) {
    return {
      isOpen: false,
      label: `Closed - opens today at ${formatMinutes(todayHours.from)}`,
    };
  }

  for (let offset = 1; offset <= 7; offset++) {
    const day = (today + offset) % 7;
    const next = dayHours(openingHours, day);
    if (next) {
      const when = offset === 1 ? 'tomorrow' : `on ${DAY_NAMES[day]}`;
      return {
        isOpen: false,
        label: `Closed - opens ${when} at ${formatMinutes(next.from)}`,
      };
    }
  }

  return { isOpen: false, label: 'Closed' };
}

export interface OpeningHoursRow {
  day: string;
  isToday: boolean;
  hours: string;
  closed: boolean;
}

/**
 * The Monday-first weekly rows for the "Opening times" table. Sunday (index 0)
 * is moved to the end to match the design.
 */
export function buildOpeningHoursRows(
  openingHours: OpeningHoursMap | null | undefined,
  timezone: string,
  now: Date = new Date()
): OpeningHoursRow[] {
  const today = new TZDate(now.getTime(), timezone).getDay();
  const order = [1, 2, 3, 4, 5, 6, 0];

  return order.map((day) => {
    const hours = openingHours ? dayHours(openingHours, day) : undefined;
    return {
      day: DAY_NAMES[day],
      isToday: day === today,
      hours: hours
        ? `${formatMinutes(hours.from)} - ${formatMinutes(hours.to)}`
        : 'Closed',
      closed: !hours,
    };
  });
}
