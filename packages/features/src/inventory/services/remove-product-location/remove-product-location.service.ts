import {
  product,
  productLocation,
  withOrgScope,
} from '@borradh-workspace/database';
import { logError, trackedResult } from '@borradh-workspace/observability';
import { and, eq } from 'drizzle-orm';
import { listLocations } from '../../../organization-locations/index.js';
import {
  type DbConnection,
  ErrorCodes,
  FeatureError,
  type Result,
  err,
  ok,
  removeLocationLink,
} from '../../../shared/index.js';
import {
  type RemoveProductLocationInput,
  removeProductLocationSchema,
} from './remove-product-location.schema.js';

/**
 * Stop stocked this product at ONE branch, leaving it in place everywhere else
 * — the "remove from this location" half of the delete prompt.
 *
 * The awkward case (a product with no assignments is stocked EVERYWHERE, so
 * removal has to materialise the complement) lives in `removeLocationLink`,
 * shared with the other join tables.
 *
 * Removing the LAST branch is refused with CONFLICT rather than performed: zero
 * rows reads as "every branch", so writing it back would re-publish the very
 * thing the operator asked to withdraw. Deactivating is how a business takes
 * something off sale everywhere.
 */
const removeProductLocationImpl = async (
  db: DbConnection,
  input: RemoveProductLocationInput
): Promise<Result<{ productId: string; locationIds: string[] }>> => {
  const parsed = removeProductLocationSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  const { productId, locationId, organizationId } = parsed.data;

  const existing = await db.query.product.findFirst({
    where: and(
      eq(product.id, productId),
      eq(product.organizationId, organizationId)
    ),
    columns: { id: true },
  });

  if (!existing) {
    return err(new FeatureError(ErrorCodes.NOT_FOUND, 'Product not found'));
  }

  try {
    // Only needed for the materialise case, but read up front so the helper
    // stays ignorant of how branches are listed.
    const orgLocations = await listLocations(db, { organizationId });
    if (!orgLocations.success) {
      return err(
        new FeatureError(
          ErrorCodes.INTERNAL_ERROR,
          'Failed to read the organisation’s locations'
        )
      );
    }

    const remaining = await removeLocationLink(db, productLocation, {
      ownerColumn: productLocation.productId,
      ownerId: productId,
      locationColumn: productLocation.locationId,
      locationId,
      orgLocationIds: orgLocations.data.items.map((l) => l.id),
      buildRow: (id) => ({ productId: productId, locationId: id }),
    });

    if (remaining === null) {
      return err(
        new FeatureError(
          ErrorCodes.CONFLICT,
          'This is the last location. Deactivate it instead of removing the last branch.'
        )
      );
    }

    return ok({ productId, locationIds: remaining });
  } catch (error) {
    logError('inventory.removeProductLocation', error, {
      feature: 'inventory',
      extra: { productId, locationId, organizationId },
    });
    return err(
      new FeatureError(
        ErrorCodes.INTERNAL_ERROR,
        'Failed to remove product location'
      )
    );
  }
};

export const removeProductLocation = (
  db: DbConnection,
  input: RemoveProductLocationInput
) =>
  trackedResult(
    'inventory.removeProductLocation',
    () => withOrgScope((tx) => removeProductLocationImpl(tx, input), { db }),
    { properties: { productId: input.productId, locationId: input.locationId } }
  );

export type RemoveProductLocationResult = Awaited<
  ReturnType<typeof removeProductLocation>
>;
