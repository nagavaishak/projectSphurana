import {
  isTransientDbError,
  organizationLocation,
  withDbRetry,
  withOrgScope,
} from '@borradh-workspace/database';
import { geocodeAddress } from '@borradh-workspace/integrations';
import { logError, trackedResult } from '@borradh-workspace/observability';
import { eq } from 'drizzle-orm';
import { syncOrganizationTimezone } from '../../../organizations/index.js';
import {
  type DbConnection,
  ErrorCodes,
  FeatureError,
  type Result,
  err,
  ok,
} from '../../../shared/index.js';
import { generateLocationSlug } from '../../shared/index.js';
import { applyLocationCatalogImpl } from '../apply-location-catalog/index.js';
import {
  type CreateLocationInput,
  createLocationSchema,
} from './create-location.schema.js';

/**
 * Internal implementation of create location
 */
const createLocationImpl = async (
  db: DbConnection,
  input: CreateLocationInput
): Promise<Result<typeof organizationLocation.$inferSelect>> => {
  // Validate input
  const parsed = createLocationSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  const data = parsed.data;

  // Resolve coordinates BEFORE touching the database. Geocoding is a slow
  // external HTTP call (up to 10s); doing it here keeps it out of the window in
  // which we hold a pooled DB connection. Previously it ran between the
  // findMany and the insert, so Fly's NAT could silently sever the idle pooled
  // connection while we awaited Google, and the subsequent insert failed with
  // postgres.js's "Cannot read properties of null (reading 'write')" — surfacing
  // as a generic 500 ("Failed to create location"). geocodeAddress swallows its
  // own errors and returns null, so this never throws.
  let latitude = data.latitude ?? null;
  let longitude = data.longitude ?? null;

  if (latitude == null || longitude == null) {
    const addressParts = [
      data.addressLine1,
      data.city,
      data.county,
      data.postalCode,
      data.country,
    ].filter(Boolean);
    const coords = await geocodeAddress(addressParts.join(', '));
    if (coords) {
      latitude = coords.latitude;
      longitude = coords.longitude;
    }
  }

  try {
    // If this is set as primary, unset any existing primary locations
    if (data.isPrimary) {
      await db
        .update(organizationLocation)
        .set({ isPrimary: false })
        .where(eq(organizationLocation.organizationId, data.organizationId));
    }

    // Get the next sort order
    const existingLocations = await db.query.organizationLocation.findMany({
      where: eq(organizationLocation.organizationId, data.organizationId),
      orderBy: (loc, { desc }) => [desc(loc.sortOrder)],
      limit: 1,
    });

    const nextSortOrder =
      existingLocations.length > 0 ? existingLocations[0].sortOrder + 1 : 0;

    // Insert the location
    const [newLocation] = await db
      .insert(organizationLocation)
      .values({
        organizationId: data.organizationId,
        name: data.name ?? null,
        // Every branch gets a readable URL segment from the moment it exists.
        // Without one the dashboard falls back to the raw cuid, and a URL you
        // cannot read is a URL nobody shares.
        slug: await generateLocationSlug(db, {
          organizationId: data.organizationId,
          name: data.name ?? 'branch',
        }),
        addressLine1: data.addressLine1,
        addressLine2: data.addressLine2 ?? null,
        city: data.city,
        county: data.county ?? null,
        postalCode: data.postalCode ?? null,
        country: data.country,
        latitude,
        longitude,
        isPrimary: data.isPrimary ?? false,
        sortOrder: nextSortOrder,
      })
      .returning();

    // The catalogue seed rides the SAME transaction as the row it seeds: the
    // create page is one Save, so a location that commits without the branches
    // its owner ticked would be a half-finished save with no retry affordance.
    // A failure here THROWS rather than returning, so the insert above rolls
    // back too; `trackedResult` converts the throw into a Result for the
    // caller. `catalog` is absent for the common "copy nothing" case, which
    // costs no queries at all.
    if (data.catalog) {
      const seeded = await applyLocationCatalogImpl(db, {
        ...data.catalog,
        locationId: newLocation.id,
        organizationId: data.organizationId,
      });
      if (!seeded.success) throw seeded.error;
    }

    return ok(newLocation);
  } catch (error) {
    // Let transient connection-class failures propagate so the withDbRetry
    // wrapper at the export level can replay the whole scoped op on a fresh
    // connection. Catching them here would convert them into a non-retryable
    // Result and re-introduce the user-facing 500.
    if (isTransientDbError(error)) throw error;

    // A rejected catalogue seed is a user-facing validation failure (an id that
    // is not theirs), not an internal fault — re-throw so it reaches the caller
    // as itself rather than being flattened into "Failed to create location".
    if (error instanceof FeatureError) throw error;

    logError('organization-locations.createLocation', error, {
      feature: 'organization-locations',
      extra: { organizationId: data.organizationId },
    });
    return err(
      new FeatureError(
        ErrorCodes.INTERNAL_ERROR,
        'Failed to create location. Please try again.'
      )
    );
  }
};

/**
 * Create a new location for an organization
 */
export const createLocation = (db: DbConnection, input: CreateLocationInput) =>
  trackedResult(
    'organization-locations.createLocation',
    // createLocationImpl re-throws transient connection-class errors; withDbRetry
    // replays the whole scoped op on a fresh connection (idempotent — the insert
    // is the only write and sortOrder is re-derived from a fresh read each
    // attempt). With RLS on, the retry opens a fresh withOrgScope transaction.
    async () => {
      const result = await withDbRetry(() =>
        withOrgScope((tx) => createLocationImpl(tx, input), { db })
      );

      // A location is the only thing that tells us which zone the business runs
      // in, so this is the moment to derive it. Deliberately AFTER the
      // transaction commits, not inside it: with RLS on, withOrgScope ignores
      // the threaded `db` and opens its own transaction on the authenticated
      // pool, so nesting would hold two pooled connections for one operation.
      //
      // Best-effort — a timezone sync must never fail the location write. The
      // sync leaves an already-set timezone alone, so calling it on every
      // location is safe.
      if (result.success) {
        await syncOrganizationTimezone(db, {
          organizationId: input.organizationId,
        });
      }

      return result;
    },
    {
      properties: { organizationId: input.organizationId },
    }
  );

export type CreateLocationResult = Awaited<ReturnType<typeof createLocation>>;
