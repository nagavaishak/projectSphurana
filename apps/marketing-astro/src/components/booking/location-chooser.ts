/**
 * Presentation helpers for the branch chooser card.
 *
 * Split out of `location-chooser.astro` so the two decisions that are easy to
 * get quietly wrong — how an address collapses to one line, and how a weekly
 * hours map collapses to a summary a customer can scan — are pinned by tests
 * rather than by reading rendered HTML.
 *
 * NOTE what is deliberately NOT here: an "Open now" badge. The venue page has
 * one (`venue-hours.ts` `computeVenueStatus`) and it needs two things this
 * payload does not have — the org's IANA timezone, and a render that happens at
 * the moment the customer looks. The chooser is server-rendered and edge-
 * cacheable, so a computed "Open now" would be the truth at render time and a
 * confident lie a few minutes later. A static weekly summary is true for as
 * long as the page lives.
 */

import type {
  BookingLocation,
  ListBookingLocationsResponse,
} from '@borradh-workspace/contracts';
import { branchSegmentFor } from '@borradh-workspace/web-shared';

/**
 * The `l/` segment that separates a branch from a service id under `/book`.
 * `/book/{serviceId}` already occupies the bare slot, so a bare `{locationSlug}`
 * would need a disambiguating lookup on every request and would break the day a
 * location slug collides with a service id. It also mirrors `/dashboard/l/…`,
 * so one convention covers both halves of the product.
 */
/**
 * The branch URL shape lives in `@borradh-workspace/web-shared`, not here.
 *
 * The backend builds the SAME paths for the links Claire sends a customer, and
 * before they shared a definition they disagreed: she quoted one branch's price
 * and then sent a branch-less link that asked which branch was meant. Two
 * implementations of a URL shape is two chances for that.
 *
 * Re-exported so the components in this folder keep one import.
 */
export {
  BRANCH_SEGMENT,
  allBranchesPath,
  branchBookingPath,
  branchSegmentFor,
  branchVenuePath,
} from '@borradh-workspace/web-shared';

/**
 * A branch the chooser can link to — which, since the segment fell back to the
 * id, is EVERY branch. The type survives as the place `segment` is resolved
 * once, so no renderer re-derives it and none of them can disagree.
 */
export type BookableBranch = BookingLocation & { segment: string };

/** Attach the resolved segment. */
export function toBookableBranch(location: BookingLocation): BookableBranch {
  return { ...location, segment: branchSegmentFor(location) };
}

export interface BookingChooserPayload
  extends Omit<ListBookingLocationsResponse, 'locations'> {
  locations: BookableBranch[];
}

/**
 * The card's address line.
 *
 * Country is dropped on purpose: every branch on this page belongs to one
 * organization, and printing "IE" under all of them is noise that pushes the
 * part that actually distinguishes two branches — the street and the town — out
 * of the first line on a phone.
 */
export function formatBranchAddress(
  location: Pick<
    BookingLocation,
    'addressLine1' | 'addressLine2' | 'city' | 'county' | 'postalCode'
  >
): string {
  return [
    location.addressLine1,
    location.addressLine2,
    location.city,
    location.county,
    location.postalCode,
  ]
    .filter((part): part is string => !!part && part.trim().length > 0)
    .map((part) => part.trim())
    .join(', ');
}

/** "9:00 am", from minutes-from-midnight. Matches `venue-hours.formatMinutes`. */
function formatMinutes(minutes: number): string {
  const h24 = Math.floor(minutes / 60);
  const m = minutes % 60;
  const meridiem = h24 < 12 ? 'am' : 'pm';
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  return `${h12}:${m.toString().padStart(2, '0')} ${meridiem}`;
}

const SHORT_DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** Monday-first, matching the venue page's weekly table. */
const WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0];

export interface OpeningHoursSummaryRow {
  /** "Mon – Fri", or "Sat" for a single day. */
  days: string;
  /** "9:00 am – 6:00 pm", or "Closed". */
  hours: string;
}

/**
 * Collapse a weekly map into the fewest rows that still say the same thing:
 * runs of consecutive days sharing identical hours become one row.
 *
 * A salon open 9–6 Monday to Friday and 10–4 on Saturday reads as two rows plus
 * "Sun — Closed", instead of seven. Seven rows per card times four branches is
 * a wall of digits nobody reads.
 *
 * Returns `[]` when there are no hours at all, which the card renders as
 * nothing rather than as "Hours not available" — an org that has simply never
 * filled hours in should not have that reported as a defect on its own page.
 */
export function summariseOpeningHours(
  openingHours: BookingLocation['openingHours']
): OpeningHoursSummaryRow[] {
  if (!openingHours || Object.keys(openingHours).length === 0) return [];

  const label = (day: number): string => {
    const entry = openingHours[String(day)];
    return entry
      ? `${formatMinutes(entry.from)} – ${formatMinutes(entry.to)}`
      : 'Closed';
  };

  const rows: OpeningHoursSummaryRow[] = [];
  let runStart = 0;

  for (let i = 0; i <= WEEK_ORDER.length; i++) {
    const atEnd = i === WEEK_ORDER.length;
    const sameAsRun =
      !atEnd && label(WEEK_ORDER[i]) === label(WEEK_ORDER[runStart]);
    if (sameAsRun) continue;

    const first = WEEK_ORDER[runStart];
    const last = WEEK_ORDER[i - 1];
    rows.push({
      days:
        first === last
          ? SHORT_DAY_NAMES[first]
          : `${SHORT_DAY_NAMES[first]} – ${SHORT_DAY_NAMES[last]}`,
      hours: label(first),
    });
    runStart = i;
  }

  return rows;
}

/**
 * A Google Maps directions link, coordinates first (they drop the pin exactly).
 * Same rule as `venue-address.directionsUrl`; duplicated rather than imported
 * because that one is typed against `VenueConfig['location']`, a different and
 * wider atom.
 */
export function branchDirectionsUrl(
  location: Pick<
    BookingLocation,
    | 'latitude'
    | 'longitude'
    | 'addressLine1'
    | 'addressLine2'
    | 'city'
    | 'county'
    | 'postalCode'
  >
): string | null {
  const query =
    location.latitude != null && location.longitude != null
      ? `${location.latitude},${location.longitude}`
      : formatBranchAddress(location);
  if (!query) return null;
  return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(query)}`;
}
