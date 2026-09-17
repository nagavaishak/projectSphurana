import {
  stockOrder,
  stockOrderFee,
  stockOrderItem,
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
import type { StockOrderWithItems } from '../../models/inventory.types.js';
import {
  type UpdateStockOrderInput,
  updateStockOrderSchema,
} from './update-stock-order.schema.js';

const updateStockOrderImpl = async (
  db: DbConnection,
  input: UpdateStockOrderInput
): Promise<Result<StockOrderWithItems>> => {
  const parsed = updateStockOrderSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  const { id, organizationId, items, fees, ...headerUpdates } = parsed.data;

  try {
    return await withOrgScope(
      async (tx) => {
        const existing = await tx.query.stockOrder.findFirst({
          where: and(
            eq(stockOrder.id, id),
            eq(stockOrder.organizationId, organizationId)
          ),
        });

        if (!existing) {
          return err(
            new FeatureError(ErrorCodes.NOT_FOUND, 'Stock order not found')
          );
        }

        if (existing.status === 'received' || existing.status === 'cancelled') {
          return err(
            new FeatureError(
              ErrorCodes.INVALID_STATE,
              `Cannot update a ${existing.status} stock order`
            )
          );
        }

        if ((items || fees) && existing.status !== 'draft') {
          return err(
            new FeatureError(
              ErrorCodes.INVALID_STATE,
              'Line items can only be changed while the order is a draft'
            )
          );
        }

        let order = existing;
        if (Object.keys(headerUpdates).length > 0) {
          const [updated] = await tx
            .update(stockOrder)
            .set(headerUpdates)
            .where(
              and(
                eq(stockOrder.id, id),
                eq(stockOrder.organizationId, organizationId)
              )
            )
            .returning();
          order = updated;
        }

        if (items) {
          await tx
            .delete(stockOrderItem)
            .where(eq(stockOrderItem.stockOrderId, id));
          await tx
            .insert(stockOrderItem)
            .values(items.map((item) => ({ ...item, stockOrderId: id })))
            .returning();
        }

        if (fees) {
          await tx
            .delete(stockOrderFee)
            .where(eq(stockOrderFee.stockOrderId, id));
          if (fees.length > 0) {
            await tx
              .insert(stockOrderFee)
              .values(fees.map((fee) => ({ ...fee, stockOrderId: id })))
              .returning();
          }
        }

        const [finalItems, finalFees] = await Promise.all([
          tx.query.stockOrderItem.findMany({
            where: eq(stockOrderItem.stockOrderId, id),
          }),
          tx.query.stockOrderFee.findMany({
            where: eq(stockOrderFee.stockOrderId, id),
          }),
        ]);

        return ok({ ...order, items: finalItems, fees: finalFees });
      },
      { db }
    );
  } catch (error) {
    logError('inventory.updateStockOrder', error, {
      feature: 'inventory',
      extra: { organizationId, id },
    });
    return err(
      new FeatureError(
        ErrorCodes.INTERNAL_ERROR,
        'Failed to update stock order'
      )
    );
  }
};

export const updateStockOrder = (
  db: DbConnection,
  input: UpdateStockOrderInput
) =>
  trackedResult(
    'inventory.updateStockOrder',
    () => updateStockOrderImpl(db, input),
    { properties: { organizationId: input.organizationId, id: input.id } }
  );
