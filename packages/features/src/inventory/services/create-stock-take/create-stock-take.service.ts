import {
  organizationLocation,
  product,
  productStock,
  stockTake,
  stockTakeItem,
  withOrgScope,
} from '@borradh-workspace/database';
import { logError, trackedResult } from '@borradh-workspace/observability';
import { and, eq, inArray } from 'drizzle-orm';
import {
  type DbConnection,
  ErrorCodes,
  FeatureError,
  type Result,
  err,
  ok,
} from '../../../shared/index.js';
import type { StockTakeWithItems } from '../../models/inventory.types.js';
import {
  type CreateStockTakeInput,
  createStockTakeSchema,
} from './create-stock-take.schema.js';

/**
 * Creates a stock take, snapshotting the current product_stock quantity at the
 * location into each item's expectedQuantity (0 when no stock row exists).
 */
const createStockTakeImpl = async (
  db: DbConnection,
  input: CreateStockTakeInput
): Promise<Result<StockTakeWithItems>> => {
  const parsed = createStockTakeSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  const { productIds, ...takeFields } = parsed.data;

  try {
    return await withOrgScope(
      async (tx) => {
        // Verify the location belongs to the org before snapshotting stock into
        // a take attached to it — a spoofed locationId would leak cross-org.
        const location = await tx.query.organizationLocation.findFirst({
          where: and(
            eq(organizationLocation.id, takeFields.locationId),
            eq(organizationLocation.organizationId, takeFields.organizationId)
          ),
          columns: { id: true },
        });
        if (!location) {
          return err(
            new FeatureError(ErrorCodes.NOT_FOUND, 'Location not found')
          );
        }

        let products: { id: string }[];
        if (productIds) {
          const uniqueIds = [...new Set(productIds)];
          products = await tx.query.product.findMany({
            where: and(
              inArray(product.id, uniqueIds),
              eq(product.organizationId, takeFields.organizationId)
            ),
          });
          if (products.length !== uniqueIds.length) {
            return err(
              new FeatureError(
                ErrorCodes.NOT_FOUND,
                'One or more products not found'
              )
            );
          }
        } else {
          products = await tx.query.product.findMany({
            where: and(
              eq(product.organizationId, takeFields.organizationId),
              eq(product.isActive, true),
              eq(product.trackStock, true)
            ),
          });
        }

        if (products.length === 0) {
          return err(
            new FeatureError(
              ErrorCodes.INVALID_STATE,
              'No products available for a stock take'
            )
          );
        }

        const stockRows = await tx.query.productStock.findMany({
          where: and(
            inArray(
              productStock.productId,
              products.map((p) => p.id)
            ),
            eq(productStock.locationId, takeFields.locationId)
          ),
        });
        const stockByProduct = new Map(
          stockRows.map((row) => [row.productId, row.quantity])
        );

        const [take] = await tx
          .insert(stockTake)
          .values(takeFields)
          .returning();

        const items = await tx
          .insert(stockTakeItem)
          .values(
            products.map((p) => ({
              stockTakeId: take.id,
              productId: p.id,
              expectedQuantity: stockByProduct.get(p.id) ?? 0,
            }))
          )
          .returning();

        return ok({ ...take, items });
      },
      { db }
    );
  } catch (error) {
    logError('inventory.createStockTake', error, {
      feature: 'inventory',
      extra: { organizationId: input.organizationId },
    });
    return err(
      new FeatureError(ErrorCodes.INTERNAL_ERROR, 'Failed to create stock take')
    );
  }
};

export const createStockTake = (
  db: DbConnection,
  input: CreateStockTakeInput
) =>
  trackedResult(
    'inventory.createStockTake',
    () => createStockTakeImpl(db, input),
    { properties: { organizationId: input.organizationId } }
  );
