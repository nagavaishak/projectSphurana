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
  err,
  ok,
} from '../../../shared/index.js';
import {
  type AssignProductLocationsInput,
  assignProductLocationsSchema,
} from './assign-product-locations.schema.js';

/**
 * Replace which branches stocked a product.
 *
 * THE ONE THING TO KNOW: **an empty `locationIds` array means "stocked at every
 * branch", not "stocked nowhere."** Zero join rows is the "everywhere" default
 * the read path is built on (`atLocationOrUnassigned`), and the only convention
 * under which this table could ship EMPTY without blanking the catalogue the
 * day branch filtering switched on. `[]` is how an owner UNDOES a per-branch
 * restriction; "available nowhere" is `isActive: false`, not this.
 *
 * A full REPLACE, matching `assignPractitionerLocations` and
 * `assignServiceLocations`.
 */
const assignProductLocationsImpl = async (
  db: DbConnection,
  input: AssignProductLocationsInput
): Promise<Result<{ productId: string; locationIds: string[] }>> => {
  const parsed = assignProductLocationsSchema.safeParse(input);
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
    await db
      .delete(productLocation)
      .where(eq(productLocation.productId, productId));

    if (locationIds.length > 0) {
      // De-duplicated: the unique constraint would reject a repeated id, and a
      // body listing one branch twice is a client bug, not a conflict worth
      // surfacing as a 409.
      await db.insert(productLocation).values(
        [...new Set(locationIds)].map((locationId) => ({
          productId: productId,
          locationId,
        }))
      );
    }

    return ok({ productId, locationIds });
  } catch (error) {
    logError('inventory.assignProductLocations', error, {
      feature: 'inventory',
      extra: { productId, organizationId },
    });
    return err(
      new FeatureError(
        ErrorCodes.INTERNAL_ERROR,
        'Failed to assign product locations'
      )
    );
  }
};

export const assignProductLocations = (
  db: DbConnection,
  input: AssignProductLocationsInput
) =>
  trackedResult(
    'inventory.assignProductLocations',
    () => withOrgScope((tx) => assignProductLocationsImpl(tx, input), { db }),
    { properties: { productId: input.productId } }
  );

export type AssignProductLocationsResult = Awaited<
  ReturnType<typeof assignProductLocations>
>;
