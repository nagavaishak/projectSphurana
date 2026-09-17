/**
 * WHICH BRANCH is this booking for — the entry decision, made once, server-side.
 *
 * Underscore-prefixed so Astro does not route it, same convention as
 * `_resolve-org.ts` beside it. It is a module rather than page frontmatter
 * because the three rules below are correctness decisions about a page that is
 * indexed and is the first thing a paying customer sees, and they need to be
 * pinned by a test rather than re-derived in each of the two routes that ask.
 *
 * ── THE THREE RULES
 *
 * 1. EVERY branch is offered. A branch is named in the URL by `slug ?? id`
 *    (`branchSegmentFor`), and an id always exists — so there is no such thing
 *    as a branch we can see but cannot link to. This rule used to filter out
 *    slug-less branches, because `resolveBookingLocation` looked a branch up
 *    by slug only and `organization_location.slug` is nullable until the
 *    backfill runs. Pre-backfill that meant EVERY slug was null, so every org
 *    fell through to rule 3 and the chooser never appeared for anyone — the
 *    feature was inert. The resolver now accepts an id, which is what lets
 *    this rule be "all of them" rather than "the lucky ones".
 *
 * 2. Exactly one branch → 302 straight to it. A chooser with one option is a
 *    click that asks a question with one answer. The customer still lands on a
 *    URL that NAMES the branch, so a refresh, a share or a back-button all
 *    keep the scope.
 *
 * 3. Zero branches → render the wizard with NO branch, which is precisely
 *    today's behaviour for an org mid-onboarding: `resolveBookingLocation`
 *    with no handle falls back to the default branch, or carries on
 *    branch-less for an org that has none. This is also where an API failure
 *    lands, and deliberately so: the downside of guessing is one branch's
 *    hours shown for another, and the downside of failing closed is that
 *    nobody can book at all. The wizard's own config call is the one authority
 *    on "this org does not exist" — an unknown slug 404s there, so this module
 *    does not duplicate that judgement.
 */

import {
  type BookableBranch,
  type BookingChooserPayload,
  toBookableBranch,
} from '@/components/booking/location-chooser';
import { resolveUpstreamApiUrl } from '@/lib/config';
import type { ListBookingLocationsResponse } from '@borradh-workspace/contracts';

export type BookingEntry =
  /** Show the chooser. Two or more branches. */
  | { kind: 'chooser'; payload: BookingChooserPayload }
  /** Exactly one branch — 302 past the chooser. */
  | { kind: 'single'; branch: BookableBranch }
  /** No branches at all: render the wizard unscoped, as today. */
  | { kind: 'branchless' };

/**
 * A hung API must not hold a lambda open while a customer stares at nothing.
 * Falling through to the unscoped wizard is a working page; a 30s spinner is
 * not. Matches the microsite document call's budget.
 */
const API_TIMEOUT_MS = 4000;

/**
 * Fetch the chooser payload. Returns `null` for every failure mode — unknown
 * org, no locations, timeout, 5xx, malformed body — because the caller's
 * response to all of them is the same (rule 3) and distinguishing them here
 * would only invite a second, disagreeing not-found path.
 */
export async function fetchBookingLocations(
  organizationSlug: string,
  fetchImpl: typeof fetch = fetch
): Promise<ListBookingLocationsResponse | null> {
  const apiUrl = resolveUpstreamApiUrl().replace(/\/$/, '');
  if (!apiUrl || !organizationSlug) return null;

  try {
    const response = await fetchImpl(
      `${apiUrl}/public/booking/${encodeURIComponent(organizationSlug)}/locations`,
      { signal: AbortSignal.timeout(API_TIMEOUT_MS) }
    );
    if (!response.ok) return null;

    const body =
      (await response.json()) as Partial<ListBookingLocationsResponse>;
    if (!Array.isArray(body.locations)) return null;
    return body as ListBookingLocationsResponse;
  } catch {
    return null;
  }
}

/** Apply the three rules to a payload (or to the absence of one). */
export function decideBookingEntry(
  response: ListBookingLocationsResponse | null
): BookingEntry {
  if (!response) return { kind: 'branchless' };

  // No filter — see rule 1. Every branch gets a segment, so the only reason to
  // fall through to rule 3 is that the org genuinely has no branches.
  const bookable = response.locations.map(toBookableBranch);

  if (bookable.length === 0) return { kind: 'branchless' };
  if (bookable.length === 1) return { kind: 'single', branch: bookable[0] };
  return { kind: 'chooser', payload: { ...response, locations: bookable } };
}
