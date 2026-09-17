import { organizationLocation } from '@borradh-workspace/database';
import type { WorkingHours } from '@borradh-workspace/database';
import { and, asc, desc, eq, or, sql } from 'drizzle-orm';
import type { DbConnection } from '../../../shared/index.js';

/**
 * The branch a PUBLIC entry point is talking about, with the columns those
 * surfaces actually need (the venue page's address block aside, which reads the
 * whole row).
 */
export interface BookingLocation {
  id: string;
  slug: string | null;
  /**
   * The branch's display name ("Dublin Branch"). Nullable at the column, and
   * genuinely null on plenty of single-branch orgs that never named the one
   * location they have — so a renderer must fall back to the address rather
   * than print an empty heading.
   */
  name: string | null;
  country: string | null;
  openingHours: WorkingHours | null;
  /**
   * The branch's postal address. Carried because the public booking config
   * shows the customer WHERE they are booking — the cart panel's venue line
   * and, on the confirmation screen, the `location` of the calendar invite
   * their phone navigates to on the day. A booking that names no branch
   * address is how a Cork customer ends up outside the Dublin clinic.
   */
  addressLine1: string | null;
  addressLine2: string | null;
  city: string | null;
  county: string | null;
  postalCode: string | null;
}

/**
 * Resolve the branch a public booking call means: the one named by
 * `locationHandle`, or — when the caller names none — the org's default branch
 * (`isPrimary` wins, ties break on the lowest `sortOrder`, exactly as
 * `resolveDefaultLocation` does).
 *
 * THE HANDLE IS A SLUG **OR** AN ID. `organization_location.slug` is nullable
 * and will stay nullable until the backfill runs, so a slug-only lookup left a
 * real branch with no public address at all — which is why
 * `isBookingLocationAddressable` had to refuse a branch we could see but could
 * not NAME. Accepting the id removes the unnameable case entirely: a branch
 * always has an id, so a branch that EXISTS is always addressable. (That guard
 * still exists, narrowed to the case that survives — a row stamped with no
 * branch at all.)
 *
 * The two namespaces cannot collide in a way that matters. Ids are generated
 * (`randomUUID`), slugs are derived from a human name, and both arms are
 * scoped to THIS org — so the worst case is a slug that looks like a uuid
 * resolving to its own branch either way. Slug is matched first regardless, so
 * a slug always wins its own name.
 *
 * WHY THIS EXISTS. `getGeneralBookingConfig`, `getGeneralBookingSlots` and
 * `submitGeneralBooking` each answer "which branch" and their answers MUST
 * agree — the price on the form, the hours the slots were drawn from and the
 * diary the appointment lands on are the same branch or the customer is quoted
 * one branch and booked into another. Before this, config and submit resolved
 * the default branch and slots filtered `isPrimary = true`, so an org whose
 * primary flag was never set already had two answers.
 *
 * Returns `null` in two distinguishable-by-the-caller cases:
 *   - `locationHandle` was given and no branch of this org matches it by slug
 *     or by id → the caller must return NOT_FOUND rather than silently serving
 *     another branch.
 *   - no slug was given and the org has no locations at all (mid-onboarding) →
 *     the caller carries on branch-less, exactly as it did before.
 *
 * NOT a `Result`: every caller wants value-or-nothing and turns the nothing
 * into its own error shape.
 */
export const resolveBookingLocation = async (
  db: DbConnection,
  organizationId: string,
  /** A branch's `slug`, or its `id` when it has no slug yet. */
  locationHandle?: string
): Promise<BookingLocation | null> => {
  const columns = {
    id: true,
    slug: true,
    name: true,
    country: true,
    openingHours: true,
    addressLine1: true,
    addressLine2: true,
    city: true,
    county: true,
    postalCode: true,
  } as const;

  const location = locationHandle
    ? await db.query.organizationLocation.findFirst({
        where: and(
          eq(organizationLocation.organizationId, organizationId),
          // Slug OR id. Both arms sit INSIDE the org scope, so an id belonging
          // to another tenant resolves to nothing rather than to that tenant's
          // branch — the id is a public URL segment and must be treated as
          // caller-supplied, not as proof of anything.
          or(
            eq(organizationLocation.slug, locationHandle),
            eq(organizationLocation.id, locationHandle)
          )
        ),
        // Deterministic when a slug and an id both match (different rows, an
        // org that named one branch after another's id): the SLUG wins, so a
        // link keeps meaning what its author typed. Ordering on the PREDICATE,
        // not on `slug` — `desc(slug)` is NULLS FIRST in Postgres, so it would
        // rank the slug-less row above the one that actually matched.
        orderBy: [desc(sql`${organizationLocation.slug} = ${locationHandle}`)],
        columns,
      })
    : await db.query.organizationLocation.findFirst({
        where: eq(organizationLocation.organizationId, organizationId),
        orderBy: [
          desc(organizationLocation.isPrimary),
          asc(organizationLocation.sortOrder),
        ],
        columns,
      });

  if (!location) return null;

  return {
    id: location.id,
    slug: location.slug ?? null,
    name: location.name ?? null,
    country: location.country ?? null,
    openingHours: (location.openingHours as WorkingHours | null) ?? null,
    addressLine1: location.addressLine1 ?? null,
    addressLine2: location.addressLine2 ?? null,
    city: location.city ?? null,
    county: location.county ?? null,
    postalCode: location.postalCode ?? null,
  };
};

/**
 * The branch an EXISTING row (an appointment, a sale) is stamped with.
 *
 * WHY THIS EXISTS. `resolveBookingLocation` answers "which branch is this
 * public call ABOUT" and falls back to the org default when it is told
 * nothing. That fallback is right for a booking form — a customer who names no
 * branch is booking at the default one — and catastrophically wrong for a row
 * that already happened: an appointment whose `location_id` is NULL (every
 * pre-backfill row) must render NO address, never the default branch's. A
 * reminder that guesses is how a Cork patient is sent to Dublin.
 *
 * So this takes an EXPLICIT `locationId` and has no fallback at all. `null` in
 * → `null` out; a `locationId` that does not belong to `organizationId` → also
 * `null`, because a cross-org id is corruption, not a branch.
 */
export const getBookingLocationById = async (
  db: DbConnection,
  organizationId: string,
  locationId: string | null | undefined
): Promise<BookingLocation | null> => {
  if (!locationId) return null;

  const location = await db.query.organizationLocation.findFirst({
    where: and(
      eq(organizationLocation.id, locationId),
      eq(organizationLocation.organizationId, organizationId)
    ),
    columns: {
      id: true,
      slug: true,
      name: true,
      country: true,
      openingHours: true,
      addressLine1: true,
      addressLine2: true,
      city: true,
      county: true,
      postalCode: true,
    },
  });

  if (!location) return null;

  return {
    id: location.id,
    slug: location.slug ?? null,
    name: location.name ?? null,
    country: location.country ?? null,
    openingHours: (location.openingHours as WorkingHours | null) ?? null,
    addressLine1: location.addressLine1 ?? null,
    addressLine2: location.addressLine2 ?? null,
    city: location.city ?? null,
    county: location.county ?? null,
    postalCode: location.postalCode ?? null,
  };
};

/**
 * A single-line, comma-joined postal address for a branch, or `null` when the
 * branch has no address parts on file.
 *
 * Null rather than `''` on purpose: every consumer treats the address as
 * optional and omits it, and an empty string would render an empty venue line
 * and put `location=` on a calendar link. Mirrors the venue page's
 * `formatAddress` so the same branch reads the same on both public surfaces.
 */
export const formatBookingLocationAddress = (
  location: Pick<
    BookingLocation,
    'addressLine1' | 'addressLine2' | 'city' | 'county' | 'postalCode'
  > | null
): string | null => {
  const lines = bookingLocationAddressLines(location);
  return lines.length > 0 ? lines.join(', ') : null;
};

/**
 * Can a PUBLIC endpoint be pointed at the branch this row is stamped with?
 *
 * NARROWED, not deleted, when the public URL segment became `slug ?? id`.
 * It used to ask "does this branch have a SLUG", because slug was the only
 * thing `resolveBookingLocation` could look up and
 * `organization_location.slug` is nullable until the backfill runs. That
 * question is now always yes: a branch always has an id, and the resolver
 * accepts one.
 *
 * The question that SURVIVES is different and easy to conflate with it: does
 * this row name a branch AT ALL? Every pre-backfill appointment has
 * `location_id = NULL`, and for those there is nothing to put in the URL. On a
 * multi-branch org, omitting the segment resolves the org's DEFAULT branch —
 * so offering online rescheduling for such a row would quietly serve, and then
 * book into, a branch the customer never chose. That is the exact defect this
 * lane exists to close, so it still refuses.
 *
 * `totalLocationCount <= 1` remains addressable whatever the row says, and it
 * is still not a loophole: with one branch, omitting the segment resolves the
 * org's default, which IS that branch. There is nothing else it could be.
 */
export const isBookingLocationAddressable = (
  location: Pick<BookingLocation, 'id'> | null,
  totalLocationCount: number
): boolean => {
  if (totalLocationCount <= 1) return true;
  return !!location?.id;
};

/**
 * The same address, kept as SEPARATE lines for a surface that stacks them —
 * the portal's booking card and detail page print the branch under its name,
 * where a comma-joined one-liner wraps badly on a phone.
 *
 * This is the one place the ordering and the empty-part filtering live;
 * `formatBookingLocationAddress` is the comma-joined projection OF this, not a
 * second implementation of it. Two formatters would be two chances for the
 * same branch to read differently on two customer-facing screens.
 */
export const bookingLocationAddressLines = (
  location: Pick<
    BookingLocation,
    'addressLine1' | 'addressLine2' | 'city' | 'county' | 'postalCode'
  > | null
): string[] => {
  if (!location) return [];
  return [
    location.addressLine1,
    location.addressLine2,
    location.city,
    location.county,
    location.postalCode,
  ]
    .map((part) => part?.trim() ?? '')
    .filter((part) => part.length > 0);
};
