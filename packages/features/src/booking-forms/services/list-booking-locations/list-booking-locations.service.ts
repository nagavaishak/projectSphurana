import {
  organization,
  organizationLocation,
  organizationPhoto,
  withPublicOrgScope,
} from '@borradh-workspace/database';
import type { CountryCode } from '@borradh-workspace/labels';
import { trackedResult } from '@borradh-workspace/observability';
import { and, asc, desc, eq, inArray, isNull } from 'drizzle-orm';
import {
  type DbConnection,
  ErrorCodes,
  FeatureError,
  type Result,
  err,
  notDeleted,
  ok,
} from '../../../shared/index.js';
import type { BookingLocationsResponse } from '../../models/index.js';
import {
  type ListBookingLocationsInput,
  listBookingLocationsSchema,
} from './list-booking-locations.schema.js';

/**
 * The branch chooser at `/sites/{orgSlug}/book` — every bookable branch of one
 * organization, as a customer who has NOT yet picked one sees them.
 *
 * WHY THIS IS NOT `getVenueConfig`. That service answers "show me THIS venue",
 * and when asked without a branch it silently resolves the primary one. Being
 * assumed into the primary branch is precisely the bug the chooser exists to
 * fix, so folding a list into a service whose whole contract is "exactly one
 * location, defaulted" would keep the defaulting alive at the one place that
 * must not default.
 *
 * WHAT "BOOKABLE" MEANS HERE. Every branch of a live org. `organization_location`
 * has no `is_active`, no `deleted_at` and no "accepts online bookings" flag —
 * a row exists iff the business currently operates that branch, and deleting it
 * is the only way to stop it appearing. Inventing a filter (say, "has opening
 * hours", or "has services assigned") would hide branches the operator can see
 * in their dashboard, with nothing in the product explaining why. The only gate
 * is the org itself: a soft-deleted org resolves to NOT_FOUND above, exactly as
 * it does for config/slots/submit.
 *
 * An org with ONE branch is not special-cased. It comes back as a one-element
 * list; the 302-past-the-chooser decision belongs to the route that renders it,
 * not to the payload.
 */
const listBookingLocationsImpl = async (
  db: DbConnection,
  input: ListBookingLocationsInput
): Promise<Result<BookingLocationsResponse>> => {
  const parsed = listBookingLocationsSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  const { organizationSlug } = parsed.data;

  // ── Slug bootstrap (runs OUTSIDE withPublicOrgScope) ──────────────────────
  // slug → org_id has to happen before org context exists; the slug_bootstrap
  // RLS policy on `organization` is what lets app_public do this one SELECT
  // with no app.current_org_id set. Mirrors get-general-booking-config.
  const org = await db.query.organization.findFirst({
    where: and(
      eq(organization.slug, organizationSlug),
      notDeleted(organization)
    ),
  });

  if (!org) {
    return err(
      new FeatureError(ErrorCodes.NOT_FOUND, 'Organization not found')
    );
  }

  // ── Scoped reads (run INSIDE withPublicOrgScope) ──────────────────────────
  // ALWAYS pass { db } so the helper uses the injected connection (the
  // app_public pool, or the test mock db) rather than the global pool.
  //
  // Both tables read below are already GRANTed to app_public
  // (0071_location_hours_public_grants, 0156_app_public_read_grants), which
  // `scripts/rls/check-rls-coverage.mjs` verifies by walking this callback.
  return withPublicOrgScope(
    org.id,
    async (tx): Promise<Result<BookingLocationsResponse>> => {
      const locations = await tx.query.organizationLocation.findMany({
        where: eq(organizationLocation.organizationId, org.id),
        // The primary branch first, then the operator's own ordering — the same
        // order `resolveDefaultLocation` and the venue page break ties on, so
        // the branch at the top of the chooser is the branch a customer who
        // never chose would have been assumed into.
        orderBy: [
          desc(organizationLocation.isPrimary),
          asc(organizationLocation.sortOrder),
          asc(organizationLocation.name),
        ],
      });

      if (locations.length === 0) {
        return err(
          new FeatureError(
            ErrorCodes.NOT_FOUND,
            'No locations found for this organization'
          )
        );
      }

      const locationIds = locations.map((l) => l.id);

      // One card image per branch. Two reads rather than one per branch: the
      // branch galleries in a single IN, plus the org-wide (null-location)
      // photos the venue page already treats as shared, used as the fallback
      // for a branch that has none of its own.
      const [branchPhotos, sharedPhotos] = await Promise.all([
        tx.query.organizationPhoto.findMany({
          where: inArray(organizationPhoto.locationId, locationIds),
          columns: {
            locationId: true,
            url: true,
            isCover: true,
            sortOrder: true,
          },
          orderBy: [
            desc(organizationPhoto.isCover),
            asc(organizationPhoto.sortOrder),
          ],
        }),
        tx.query.organizationPhoto.findMany({
          where: and(
            eq(organizationPhoto.organizationId, org.id),
            isNull(organizationPhoto.locationId)
          ),
          columns: { url: true, isCover: true, sortOrder: true },
          orderBy: [
            desc(organizationPhoto.isCover),
            asc(organizationPhoto.sortOrder),
          ],
        }),
      ]);

      // First row wins per branch — the query already ordered cover-first, then
      // by the operator's gallery ordering.
      const photoByLocation = new Map<string, string>();
      for (const photo of branchPhotos) {
        if (!photo.locationId) continue;
        if (!photoByLocation.has(photo.locationId)) {
          photoByLocation.set(photo.locationId, photo.url);
        }
      }
      const sharedPhoto = sharedPhotos[0]?.url ?? null;

      return ok({
        organizationName: org.name,
        organizationSlug: org.slug,
        organizationLogo: org.logo,
        locations: locations.map((location) => ({
          id: location.id,
          slug: location.slug,
          name: location.name,
          addressLine1: location.addressLine1,
          addressLine2: location.addressLine2,
          city: location.city,
          county: location.county,
          postalCode: location.postalCode,
          country: location.country as CountryCode,
          latitude: location.latitude,
          longitude: location.longitude,
          // Same fallback ladder as the venue page: the branch's standing
          // hours, else the org's business hours. A chooser that printed
          // "hours unavailable" for every branch of an org that sets hours
          // once, org-wide, would be reporting a gap that is not there.
          openingHours: location.openingHours ?? org.businessHours ?? null,
          photo: photoByLocation.get(location.id) ?? sharedPhoto,
          isPrimary: location.isPrimary,
        })),
      });
    },
    { db }
  );
};

export const listBookingLocations = (
  db: DbConnection,
  input: ListBookingLocationsInput
) =>
  trackedResult(
    'bookingForms.listBookingLocations',
    () => listBookingLocationsImpl(db, input),
    {
      properties: { organizationSlug: input.organizationSlug },
      internalErrorsOnly: true,
    }
  );

export type ListBookingLocationsResult = Awaited<
  ReturnType<typeof listBookingLocations>
>;
