import {
  type ProductStock,
  organizationLocation,
  product,
  productStock,
  withOrgScope,
} from '@borradh-workspace/database';
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
  type AdjustProductStockInput,
  adjustProductStockSchema,
} from './adjust-product-stock.schema.js';

/**
 * Sets the absolute stock quantity for a product at a location (upsert on the
 * (productId, locationId) unique key) and detects low-stock crossings.
 */
const adjustProductStockImpl = async (
  db: DbConnection,
  input: AdjustProductStockInput
): Promise<Result<ProductStock>> => {
  const parsed = adjustProductStockSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  const { productId, locationId, organizationId, quantity } = parsed.data;

  try {
    return await withOrgScope(
      async (tx) => {
        const owner = await tx.query.product.findFirst({
          where: and(
            eq(product.id, productId),
            eq(product.organizationId, organizationId)
          ),
        });

        if (!owner) {
          return err(
            new FeatureError(ErrorCodes.NOT_FOUND, 'Product not found')
          );
        }

        // Verify the location belongs to the org before writing stock to it —
        // a spoofed locationId would otherwise write cross-org stock rows.
        const location = await tx.query.organizationLocation.findFirst({
          where: and(
            eq(organizationLocation.id, locationId),
            eq(organizationLocation.organizationId, organizationId)
          ),
          columns: { id: true },
        });
        if (!location) {
          return err(
            new FeatureError(ErrorCodes.NOT_FOUND, 'Location not found')
          );
        }

        const [row] = await tx
          .insert(productStock)
          .values({ productId, locationId, quantity })
          .onConflictDoUpdate({
            target: [productStock.productId, productStock.locationId],
            set: { quantity },
          })
          .returning();

        const isLowStock =
          owner.trackStock &&
          owner.lowStockNotify &&
          owner.lowStockLevel !== null &&
          quantity <= owner.lowStockLevel;

        if (isLowStock) {
          // TODO(inventory): dispatch a low-stock notification via the existing
          // notifications feature (packages/features/src/notifications —
          // createNotification / dispatchNotification). Deliberately left as a
          // hook point; notification plumbing is out of scope for this slice.
        }

        return ok(row);
      },
      { db }
    );
  } catch (error) {
    logError('inventory.adjustProductStock', error, {
      feature: 'inventory',
      extra: { organizationId, productId, locationId, quantity },
    });
    return err(
      new FeatureError(ErrorCodes.INTERNAL_ERROR, 'Failed to adjust stock')
    );
  }
};

export const adjustProductStock = (
  db: DbConnection,
  input: AdjustProductStockInput
) =>
  trackedResult(
    'inventory.adjustProductStock',
    () => adjustProductStockImpl(db, input),
    {
      properties: {
        organizationId: input.organizationId,
        productId: input.productId,
        locationId: input.locationId,
      },
    }
  );
