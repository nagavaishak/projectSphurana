import {
  organizationLocation,
  withOrgScope,
} from '@borradh-workspace/database';
import { logError, trackedResult } from '@borradh-workspace/observability';
import { and, eq } from 'drizzle-orm';
import { syncOrganizationTimezone } from '../../../organizations/index.js';
import {
  type DbConnection,
  ErrorCodes,
  FeatureError,
  type Result,
  err,
  ok,
} from '../../../shared/index.js';
import {
  type SetPrimaryLocationInput,
  setPrimaryLocationSchema,
} from './set-primary-location.schema.js';

/**
 * Internal implementation of set primary location
 */
const setPrimaryLocationImpl = async (
  db: DbConnection,
  input: SetPrimaryLocationInput
): Promise<Result<typeof organizationLocation.$inferSelect>> => {
  // Validate input
  const parsed = setPrimaryLocationSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  const { id, organizationId } = parsed.data;

  try {
    // Check if location exists and belongs to organization
    const existing = await db.query.organizationLocation.findFirst({
      where: and(
        eq(organizationLocation.id, id),
        eq(organizationLocation.organizationId, organizationId)
      ),
    });

    if (!existing) {
      return err(new FeatureError(ErrorCodes.NOT_FOUND, 'Location not found'));
    }

    // Unset any existing primary locations
    await db
      .update(organizationLocation)
      .set({ isPrimary: false })
      .where(eq(organizationLocation.organizationId, organizationId));

    // Set this location as primary
    const [updated] = await db
      .update(organizationLocation)
      .set({ isPrimary: true })
      .where(eq(organizationLocation.id, id))
      .returning();

    return ok({
      id: updated.id,
      organizationId: updated.organizationId,
      name: updated.name,
      addressLine1: updated.addressLine1,
      addressLine2: updated.addressLine2,
      city: updated.city,
      county: updated.county,
      postalCode: updated.postalCode,
      country: updated.country,
      latitude: updated.latitude,
      longitude: updated.longitude,
      openingHours: updated.openingHours,
      stripeTerminalLocationId: updated.stripeTerminalLocationId,
      slug: updated.slug,
      about: updated.about,
      amenities: updated.amenities,
      isPrimary: updated.isPrimary,
      sortOrder: updated.sortOrder,
      createdAt: updated.createdAt,
      updatedAt: updated.updatedAt,
    });
  } catch (error) {
    logError('organization-locations.setPrimaryLocation', error, {
      feature: 'organization-locations',
      extra: { id, organizationId },
    });
    return err(
      new FeatureError(
        ErrorCodes.INTERNAL_ERROR,
        'Failed to set primary location. Please try again.'
      )
    );
  }
};

/**
 * Set a location as the primary location for an organization
 */
export const setPrimaryLocation = (
  db: DbConnection,
  input: SetPrimaryLocationInput
) =>
  trackedResult(
    'organization-locations.setPrimaryLocation',
    async () => {
      const result = await withOrgScope(
        (tx) => setPrimaryLocationImpl(tx, input),
        { db }
      );

      // The primary location is what the timezone derives from, so promoting a
      // different one can change it. No `force`: this only fills in an org
      // still on the 'UTC' default. (See create-location for why the sync runs
      // after the transaction rather than inside it.)
      if (result.success) {
        await syncOrganizationTimezone(db, {
          organizationId: input.organizationId,
        });
      }

      return result;
    },
    {
      properties: { id: input.id, organizationId: input.organizationId },
    }
  );

export type SetPrimaryLocationResult = Awaited<
  ReturnType<typeof setPrimaryLocation>
>;
