import {
  isUniqueViolation,
  organizationLocation,
  withOrgScope,
} from '@borradh-workspace/database';
import type { VenueAmenity } from '@borradh-workspace/labels';
import { logError, trackedResult } from '@borradh-workspace/observability';
import { and, eq } from 'drizzle-orm';
import {
  type DbConnection,
  ErrorCodes,
  FeatureError,
  type Result,
  err,
  ok,
} from '../../../shared/index.js';
import {
  type UpdateLocationVenueInput,
  updateLocationVenueSchema,
} from './update-location-venue.schema.js';

export interface UpdateLocationVenueResult {
  locationId: string;
  about: string | null;
  amenities: VenueAmenity[];
  slug: string | null;
}

const updateLocationVenueImpl = async (
  db: DbConnection,
  input: UpdateLocationVenueInput
): Promise<Result<UpdateLocationVenueResult>> => {
  const parsed = updateLocationVenueSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  const { organizationId, locationId, about, amenities, slug } = parsed.data;

  // Only touch the fields the caller actually sent.
  const updates: {
    about?: string | null;
    amenities?: VenueAmenity[];
    slug?: string | null;
  } = {};
  if (about !== undefined) {
    updates.about = about;
  }
  if (amenities !== undefined) {
    updates.amenities = amenities;
  }
  if (slug !== undefined) {
    updates.slug = slug;
  }

  if (Object.keys(updates).length === 0) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'No fields to update')
    );
  }

  try {
    // The update is scoped by BOTH id and organizationId, so a caller can never
    // edit another org's location even with a guessed id. A missing row → 404.
    const [updated] = await db
      .update(organizationLocation)
      .set(updates)
      .where(
        and(
          eq(organizationLocation.id, locationId),
          eq(organizationLocation.organizationId, organizationId)
        )
      )
      .returning({
        locationId: organizationLocation.id,
        about: organizationLocation.about,
        amenities: organizationLocation.amenities,
        slug: organizationLocation.slug,
      });

    if (!updated) {
      return err(new FeatureError(ErrorCodes.NOT_FOUND, 'Location not found'));
    }

    return ok({
      locationId: updated.locationId,
      about: updated.about,
      amenities: updated.amenities ?? [],
      slug: updated.slug,
    });
  } catch (error) {
    // A duplicate slug collides on the unique constraint. drizzle wraps the
    // postgres.js error — the constraint lives on the `.cause` chain, not
    // `error.message` (see isUniqueViolation).
    if (isUniqueViolation(error, 'organization_location_org_slug_unique')) {
      return err(
        new FeatureError(
          ErrorCodes.ALREADY_EXISTS,
          'That slug is already taken'
        )
      );
    }

    logError('venue.updateLocationVenue', error, {
      feature: 'venue',
      extra: { organizationId, locationId },
    });
    return err(
      new FeatureError(
        ErrorCodes.INTERNAL_ERROR,
        'Failed to update venue details'
      )
    );
  }
};

export const updateLocationVenue = (
  db: DbConnection,
  input: UpdateLocationVenueInput
) =>
  trackedResult(
    'venue.updateLocationVenue',
    () => withOrgScope((tx) => updateLocationVenueImpl(tx, input), { db }),
    {
      properties: {
        organizationId: input.organizationId,
        locationId: input.locationId,
      },
    }
  );

export type UpdateLocationVenueServiceResult = Awaited<
  ReturnType<typeof updateLocationVenue>
>;
