import { micrositeBookingUrl } from './microsite-links.js';

/**
 * Does this org run on the built-in Borradh calendar?
 *
 * For a native org, availability comes from `shift` rows and bookings are
 * written straight to our own `appointment` table — there is no external
 * account to consult, so `primaryCalendarAccountId` is (and always will be)
 * null. Checking for that account id is what previously made every native org
 * look "unconfigured" to the availability and chatbot layers.
 *
 * A null `primaryCalendarType` is NOT native: that is the dominant production
 * state for orgs that send customers to an external booking system, and they
 * must keep doing exactly that.
 *
 * See ENG-500 for the data-model cleanup that should eventually replace this
 * predicate with an explicit availability-source field.
 */
export function usesNativeCalendar(org: {
  bookingDestination?: string | null;
  /** @deprecated Read `bookingDestination`. Retained only until ENG-500 PR 2 drops the column. */
  primaryCalendarType?: string | null;
}): boolean {
  // `bookingDestination` is the field of record. `primaryCalendarType` is only
  // consulted when the caller has not selected the new column yet, which keeps
  // this correct during the expand/contract window rather than silently
  // reporting "not native" and switching an org's booking link.
  if (org.bookingDestination != null) {
    return org.bookingDestination === 'borradh';
  }
  return org.primaryCalendarType === 'borradh';
}

/**
 * Can we resolve real availability for this org, i.e. may the chatbot be handed
 * the `checkAvailability` tool?
 *
 * Two sources qualify, and they are NOT interchangeable:
 *  - a native org, whose availability lives in `shift` rows (no external
 *    account exists, so `primaryCalendarAccountId` is always null); or
 *  - an external calendar link, which needs BOTH a type and an account id.
 *
 * Why this exists: the chatbot layer used to inline
 * `!!(primaryCalendarType && primaryCalendarAccountId)` at each call site,
 * which is false for EVERY native org — `'borradh' && null`. That silently
 * withheld the availability tool from exactly the orgs whose availability we
 * can answer best, leaving the model to improvise dates from the operator's
 * free-text directive. `checkAvailability` itself was fixed for native orgs in
 * ENG-500; these call sites were missed, so the fix never reached the bot.
 *
 * Observed cost (2026-08-27, "shine by s"): the grounded path offered three
 * real slots on its one permitted turn, then the model — with no tool and no
 * date — refused a Friday that was two days clear of the clinic's annual leave
 * and lost the booking.
 */
export function canResolveAvailability(org: {
  bookingDestination?: string | null;
  primaryCalendarType?: string | null;
  primaryCalendarAccountId?: string | null;
}): boolean {
  if (usesNativeCalendar(org)) return true;
  return !!(org.primaryCalendarType && org.primaryCalendarAccountId);
}

/**
 * The only booking URL a native-calendar org may ever show a customer.
 *
 * Returns the org's own booking page, or `null` when it cannot be built (no
 * slug / no web url configured). It deliberately never falls back to
 * `defaultBookingLink`: a native org that still carries an external link from
 * a previous setup must not send customers into a booking system that its
 * in-chat flow, availability and reminders know nothing about — that produces
 * double bookings and appointments the clinic never sees in Borradh.
 *
 * Callers should treat `null` as "this org has no booking link", not as a cue
 * to reach for the external one.
 *
 * `primaryDomain` is the org's LIVE primary custom domain (see
 * `microsite-host.ts`), or null for the path tier. It is a required parameter
 * rather than an optional one, and rather than a field read off `org`, so that
 * adding a call site is a type error until it has decided which host the link
 * belongs on — silently defaulting to our domain is precisely the ENG-770
 * failure mode.
 *
 * The URL itself is NOT composed here. This function used to take a `webUrl`
 * and concatenate the path, which made it a second authority on the shape —
 * and it duly drifted: it kept building on the dashboard host after booking
 * moved to marketing, and kept the old path after booking moved under the
 * microsite base. `micrositeBookingUrl` is the single builder; this decides
 * only WHETHER an org gets a native link.
 *
 * `branchSegment` names the branch when the caller knows which one this is
 * about (`branchSegmentFor(location)`). Omitting it yields the un-branched
 * entry, which is correct only when nobody has said which branch: see the
 * builder's note. `resolveConversationBranch` is what supplies it on the
 * chatbot path, and it already returns null rather than guessing.
 */
export function nativeBookingLink(
  org: { slug: string | null },
  primaryDomain: string | null,
  branchSegment?: string | null
): string | null {
  if (!org.slug) return null;
  return micrositeBookingUrl(
    { organizationSlug: org.slug, primaryDomain },
    branchSegment
  );
}
