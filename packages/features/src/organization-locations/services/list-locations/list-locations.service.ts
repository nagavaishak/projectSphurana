import {
  organizationLocation,
  withOrgScope,
} from '@borradh-workspace/database';
import { trackedResult } from '@borradh-workspace/observability';
import { eq } from 'drizzle-orm';
import {
  type DbConnection,
  ErrorCodes,
  FeatureError,
  type Result,
  err,
  ok,
} from '../../../shared/index.js';
import {
  type ListLocationsInput,
  listLocationsSchema,
} from './list-locations.schema.js';

/**
 * Internal implementation of list locations
 */
const listLocationsImpl = async (
  db: DbConnection,
  input: ListLocationsInput
): Promise<Result<{ items: (typeof organizationLocation.$inferSelect)[] }>> => {
  // Validate input
  const parsed = listLocationsSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  const { organizationId } = parsed.data;

  const locations = await db.query.organizationLocation.findMany({
    where: eq(organizationLocation.organizationId, organizationId),
    orderBy: (loc, { asc }) => [asc(loc.sortOrder)],
  });

  return ok({
    items: locations.map((loc) => ({
      id: loc.id,
      organizationId: loc.organizationId,
      name: loc.name,
      addressLine1: loc.addressLine1,
      addressLine2: loc.addressLine2,
      city: loc.city,
      county: loc.county,
      postalCode: loc.postalCode,
      country: loc.country,
      latitude: loc.latitude,
      longitude: loc.longitude,
      openingHours: loc.openingHours,
      stripeTerminalLocationId: loc.stripeTerminalLocationId,
      slug: loc.slug,
      about: loc.about,
      amenities: loc.amenities,
      isPrimary: loc.isPrimary,
      sortOrder: loc.sortOrder,
      createdAt: loc.createdAt,
      updatedAt: loc.updatedAt,
    })),
  });
};

/**
 * List all locations for an organization
 */
export const listLocations = (db: DbConnection, input: ListLocationsInput) =>
  trackedResult(
    'organization-locations.listLocations',
    () => withOrgScope((tx) => listLocationsImpl(tx, input), { db }),
    {
      properties: { organizationId: input.organizationId },
    }
  );

export type ListLocationsResult = Awaited<ReturnType<typeof listLocations>>;
