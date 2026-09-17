import {
  type StockOrderItem,
  productStock,
  stockOrder,
  stockOrderFee,
  stockOrderItem,
  withOrgScope,
} from '@borradh-workspace/database';
import { logError, trackedResult } from '@borradh-workspace/observability';
import { and, eq, sql } from 'drizzle-orm';
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
  type ReceiveStockOrderInput,
  receiveStockOrderSchema,
} from './receive-stock-order.schema.js';

/**
 * Records a receipt event against a stock order. Each payload quantity is the
 * amount received in this event (a delta): it is added to the line item's
 * cumulative receivedQuantity and increments product_stock at the order's
 * destination location. The order moves to `received` once every line item has
 * receivedQuantity >= quantity, otherwise `partially_received`.
 */
const receiveStockOrderImpl = async (
  db: DbConnection,
  input: ReceiveStockOrderInput
): Promise<Result<StockOrderWithItems>> => {
  const parsed = receiveStockOrderSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  const { stockOrderId, organizationId, items: receipts } = parsed.data;

  try {
    return await withOrgScope(
      async (tx) => {
        const order = await tx.query.stockOrder.findFirst({
          where: and(
            eq(stockOrder.id, stockOrderId),
            eq(stockOrder.organizationId, organizationId)
          ),
          with: { items: true },
        });

        if (!order) {
          return err(
            new FeatureError(ErrorCodes.NOT_FOUND, 'Stock order not found')
          );
        }

        if (order.status === 'received' || order.status === 'cancelled') {
          return err(
            new FeatureError(
              ErrorCodes.INVALID_STATE,
              `Cannot receive a ${order.status} stock order`
            )
          );
        }

        if (!order.locationId) {
          return err(
            new FeatureError(
              ErrorCodes.INVALID_STATE,
              'Stock order has no destination location'
            )
          );
        }

        const orderItems = (order as typeof order & { items: StockOrderItem[] })
          .items;
        const itemsById = new Map(orderItems.map((item) => [item.id, item]));

        const updatedItems: StockOrderItem[] = [...orderItems];
        for (const receipt of receipts) {
          const item = itemsById.get(receipt.itemId);
          if (!item) {
            return err(
              new FeatureError(
                ErrorCodes.NOT_FOUND,
                'Stock order item not found'
              )
            );
          }

          const delta = receipt.receivedQuantity;
          if (delta === 0) continue;

          const newReceived = item.receivedQuantity + delta;

          // Cumulative received can never exceed what was ordered — otherwise a
          // typo would inflate stock beyond the PO and never let the order
          // settle to `received` correctly.
          if (newReceived > item.quantity) {
            return err(
              new FeatureError(
                ErrorCodes.VALIDATION_ERROR,
                'Received quantity exceeds the ordered quantity'
              )
            );
          }

          await tx
            .update(stockOrderItem)
            .set({ receivedQuantity: newReceived })
            .where(eq(stockOrderItem.id, item.id));

          // Increment stock at the order's destination location
          await tx
            .insert(productStock)
            .values({
              productId: item.productId,
              locationId: order.locationId,
              quantity: delta,
            })
            .onConflictDoUpdate({
              target: [productStock.productId, productStock.locationId],
              set: {
                quantity: sql`${productStock.quantity} + ${delta}`,
              },
            });

          const idx = updatedItems.findIndex((i) => i.id === item.id);
          updatedItems[idx] = { ...item, receivedQuantity: newReceived };
        }

        const fullyReceived = updatedItems.every(
          (item) => item.receivedQuantity >= item.quantity
        );
        const nextStatus = fullyReceived ? 'received' : 'partially_received';

        const [updatedOrder] = await tx
          .update(stockOrder)
          .set({ status: nextStatus })
          .where(eq(stockOrder.id, stockOrderId))
          .returning();

        const fees = await tx.query.stockOrderFee.findMany({
          where: eq(stockOrderFee.stockOrderId, stockOrderId),
        });

        return ok({ ...updatedOrder, items: updatedItems, fees });
      },
      { db }
    );
  } catch (error) {
    logError('inventory.receiveStockOrder', error, {
      feature: 'inventory',
      extra: { organizationId, stockOrderId },
    });
    return err(
      new FeatureError(
        ErrorCodes.INTERNAL_ERROR,
        'Failed to receive stock order'
      )
    );
  }
};

export const receiveStockOrder = (
  db: DbConnection,
  input: ReceiveStockOrderInput
) =>
  trackedResult(
    'inventory.receiveStockOrder',
    () => receiveStockOrderImpl(db, input),
    {
      properties: {
        organizationId: input.organizationId,
        stockOrderId: input.stockOrderId,
      },
    }
  );
