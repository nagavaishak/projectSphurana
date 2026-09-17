import {
  product,
  productLocation,
  withOrgScope,
} from '@borradh-workspace/database';
import { logError, trackedResult } from '@borradh-workspace/observability';
import { and, eq } from 'drizzle-orm';
import { assertLocationsBelongToOrg } from '../../../organization-locations/index.js';
import {
  type DbConnection,
  ErrorCodes,
  FeatureError,
  type Result,
  addLocationLinks,
  err,
  ok,
} from '../../../shared/index.js';
import {
  type AddProductLocationsInput,
  addProductLocationsSchema,
} from './add-product-locations.schema.js';

/**
 * Also stocked this product at these branches — the write behind "import from
 * another location".
 *
 * ADDITIVE, unlike `assign…Locations`, which REPLACES the whole set. The rules
 * that make an add correct (a product available everywhere must not be
 * narrowed; a re-sent import must not 409) live in `addLocationLinks`, shared
 * with the other join tables.
 */
const addProductLocationsImpl = async (
  db: DbConnection,
  input: AddProductLocationsInput
): Promise<Result<{ productId: string; locationIds: string[] }>> => {
  const parsed = addProductLocationsSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  const { productId, organizationId, locationIds } = parsed.data;

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

  // The branch ids come from the request body — see the note on
  // `assertLocationsBelongToOrg` for why this is a hard failure.
  const owned = await assertLocationsBelongToOrg(db, {
    organizationId,
    locationIds,
  });
  if (!owned.success) return err(owned.error);

  try {
    const linked = await addLocationLinks(db, productLocation, {
      ownerColumn: productLocation.productId,
      ownerId: productId,
      locationColumn: productLocation.locationId,
      locationIds,
      buildRow: (locationId) => ({ productId: productId, locationId }),
    });

    return ok({ productId, locationIds: linked });
  } catch (error) {
    logError('inventory.addProductLocations', error, {
      feature: 'inventory',
      extra: { productId, organizationId, locationIds },
    });
    return err(
      new FeatureError(
        ErrorCodes.INTERNAL_ERROR,
        'Failed to add product locations'
      )
    );
  }
};

export const addProductLocations = (
  db: DbConnection,
  input: AddProductLocationsInput
) =>
  trackedResult(
    'inventory.addProductLocations',
    () => withOrgScope((tx) => addProductLocationsImpl(tx, input), { db }),
    { properties: { productId: input.productId } }
  );

export type AddProductLocationsResult = Awaited<
  ReturnType<typeof addProductLocations>
>;
