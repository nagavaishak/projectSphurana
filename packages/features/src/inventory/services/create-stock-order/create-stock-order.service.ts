import {
  organizationLocation,
  product,
  stockOrder,
  stockOrderFee,
  stockOrderItem,
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
import type { StockOrderWithItems } from '../../models/inventory.types.js';
import {
  type CreateStockOrderInput,
  createStockOrderSchema,
} from './create-stock-order.schema.js';

const createStockOrderImpl = async (
  db: DbConnection,
  input: CreateStockOrderInput
): Promise<Result<StockOrderWithItems>> => {
  const parsed = createStockOrderSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  const { items, fees, ...orderFields } = parsed.data;

  try {
    return await withOrgScope(
      async (tx) => {
        const productIds = [...new Set(items.map((i) => i.productId))];
        const owned = await tx.query.product.findMany({
          where: and(
            inArray(product.id, productIds),
            eq(product.organizationId, orderFields.organizationId)
          ),
        });

        if (owned.length !== productIds.length) {
          return err(
            new FeatureError(
              ErrorCodes.NOT_FOUND,
              'One or more products not found'
            )
          );
        }

        // Verify the destination location (when set) belongs to the org before
        // writing — a spoofed locationId would attach the order to another org.
        if (orderFields.locationId) {
          const location = await tx.query.organizationLocation.findFirst({
            where: and(
              eq(organizationLocation.id, orderFields.locationId),
              eq(
                organizationLocation.organizationId,
                orderFields.organizationId
              )
            ),
            columns: { id: true },
          });
          if (!location) {
            return err(
              new FeatureError(ErrorCodes.NOT_FOUND, 'Location not found')
            );
          }
        }

        const [order] = await tx
          .insert(stockOrder)
          .values(orderFields)
          .returning();

        const insertedItems = await tx
          .insert(stockOrderItem)
          .values(items.map((item) => ({ ...item, stockOrderId: order.id })))
          .returning();

        const insertedFees =
          fees.length > 0
            ? await tx
                .insert(stockOrderFee)
                .values(fees.map((fee) => ({ ...fee, stockOrderId: order.id })))
                .returning()
            : [];

        return ok({ ...order, items: insertedItems, fees: insertedFees });
      },
      { db }
    );
  } catch (error) {
    logError('inventory.createStockOrder', error, {
      feature: 'inventory',
      extra: { organizationId: input.organizationId },
    });
    return err(
      new FeatureError(
        ErrorCodes.INTERNAL_ERROR,
        'Failed to create stock order'
      )
    );
  }
};

export const createStockOrder = (
  db: DbConnection,
  input: CreateStockOrderInput
) =>
  trackedResult(
    'inventory.createStockOrder',
    () => createStockOrderImpl(db, input),
    { properties: { organizationId: input.organizationId } }
  );
