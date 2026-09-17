import {
  organizationLocation,
  withOrgScope,
} from '@borradh-workspace/database';
import { geocodeAddress } from '@borradh-workspace/integrations';
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
  type UpdateLocationInput,
  updateLocationSchema,
} from './update-location.schema.js';

/**
 * Internal implementation of update location
 */
const updateLocationImpl = async (
  db: DbConnection,
  input: UpdateLocationInput
): Promise<Result<typeof organizationLocation.$inferSelect>> => {
  // Validate input
  const parsed = updateLocationSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  const { id, organizationId, ...updateData } = parsed.data;

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

    // If setting as primary, unset any existing primary locations
    if (updateData.isPrimary === true) {
      await db
        .update(organizationLocation)
        .set({ isPrimary: false })
        .where(eq(organizationLocation.organizationId, organizationId));
    }

    // Build update object with only provided fields
    const updates: Partial<typeof organizationLocation.$inferInsert> = {};
    if (updateData.name !== undefined) updates.name = updateData.name;
    if (updateData.addressLine1 !== undefined)
      updates.addressLine1 = updateData.addressLine1;
    if (updateData.addressLine2 !== undefined)
      updates.addressLine2 = updateData.addressLine2;
    if (updateData.city !== undefined) updates.city = updateData.city;
    if (updateData.county !== undefined) updates.county = updateData.county;
    if (updateData.postalCode !== undefined)
      updates.postalCode = updateData.postalCode;
    if (updateData.country !== undefined) updates.country = updateData.country;
    if (updateData.isPrimary !== undefined)
      updates.isPrimary = updateData.isPrimary;
    if (updateData.sortOrder !== undefined)
      updates.sortOrder = updateData.sortOrder;
    if (updateData.latitude !== undefined)
      updates.latitude = updateData.latitude;
    if (updateData.longitude !== undefined)
      updates.longitude = updateData.longitude;

    // If address fields changed but no coordinates provided, attempt geocoding
    const addressChanged =
      updateData.addressLine1 !== undefined ||
      updateData.city !== undefined ||
      updateData.country !== undefined;
    const hasCoords =
      updateData.latitude != null && updateData.longitude != null;
    if (addressChanged && !hasCoords) {
      const resolved = {
        addressLine1: updateData.addressLine1 ?? existing.addressLine1,
        city: updateData.city ?? existing.city,
        county: updateData.county ?? existing.county,
        postalCode: updateData.postalCode ?? existing.postalCode,
        country: updateData.country ?? existing.country,
      };
      const addressParts = [
        resolved.addressLine1,
        resolved.city,
        resolved.county,
        resolved.postalCode,
        resolved.country,
      ].filter(Boolean);
      const coords = await geocodeAddress(addressParts.join(', '));
      if (coords) {
        updates.latitude = coords.latitude;
        updates.longitude = coords.longitude;
      }
    }

    // Update the location
    const [updated] = await db
      .update(organizationLocation)
      .set(updates)
      .where(eq(organizationLocation.id, id))
      .returning();

    return ok(updated);
  } catch (error) {
    logError('organization-locations.updateLocation', error, {
      feature: 'organization-locations',
      extra: { id, organizationId },
    });
    return err(
      new FeatureError(
        ErrorCodes.INTERNAL_ERROR,
        'Failed to update location. Please try again.'
      )
    );
  }
};

/**
 * Update a location for an organization
 */
export const updateLocation = (db: DbConnection, input: UpdateLocationInput) =>
  trackedResult(
    'organization-locations.updateLocation',
    async () => {
      const result = await withOrgScope((tx) => updateLocationImpl(tx, input), {
        db,
      });

      // Re-derive after the transaction commits (see the note in
      // create-location for why this is not nested inside it).
      //
      // `force` when the COUNTRY changed: a business that moves to another
      // country has genuinely changed zone, and that must override a value
      // already on the org. Any other edit syncs without force, so it can only
      // ever fill in an org still on the 'UTC' default.
      if (result.success) {
        await syncOrganizationTimezone(db, {
          organizationId: input.organizationId,
          force: input.country !== undefined,
        });
      }

      return result;
    },
    {
      properties: { id: input.id, organizationId: input.organizationId },
    }
  );

export type UpdateLocationResult = Awaited<ReturnType<typeof updateLocation>>;
