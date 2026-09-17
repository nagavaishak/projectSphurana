import { sale, withOrgScope } from '@borradh-workspace/database';
import { trackedResult } from '@borradh-workspace/observability';
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
  type GetShopOrderStatusInput,
  getShopOrderStatusSchema,
} from './get-shop-order-status.schema.js';

/** Guest-safe order lookup. The opaque email link token is the only credential;
 * never expose the customer email or staff/internal payment data here. */
const getShopOrderStatusImpl = async (
  db: DbConnection,
  input: GetShopOrderStatusInput
): Promise<
  Result<{
    id: string;
    fulfilmentStatus: 'awaiting_collection' | 'ready' | 'collected';
    locationName: string | null;
    items: Array<{ name: string; quantity: number }>;
    createdAt: Date;
  }>
> => {
  const parsed = getShopOrderStatusSchema.safeParse(input);
  if (!parsed.success)
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid order link')
    );
  const data = parsed.data;
  const result = await withOrgScope(
    (tx) =>
      tx.query.sale.findFirst({
        where: and(
          eq(sale.organizationId, data.organizationId),
          eq(sale.orderAccessToken, data.accessToken)
        ),
        columns: { id: true, fulfilmentStatus: true, createdAt: true },
        with: {
          location: { columns: { name: true } },
          items: { columns: { name: true, quantity: true } },
        },
      }),
    { db }
  );
  if (
    !result ||
    !['awaiting_collection', 'ready', 'collected'].includes(
      result.fulfilmentStatus
    )
  )
    return err(new FeatureError(ErrorCodes.NOT_FOUND, 'Order not found'));
  return ok({
    id: result.id,
    fulfilmentStatus: result.fulfilmentStatus as
      | 'awaiting_collection'
      | 'ready'
      | 'collected',
    locationName: result.location?.name ?? null,
    items: result.items.map((item) => ({
      name: item.name,
      quantity: item.quantity,
    })),
    createdAt: result.createdAt,
  });
};

export const getShopOrderStatus = (
  db: DbConnection,
  input: GetShopOrderStatusInput
) =>
  trackedResult(
    'sales.getShopOrderStatus',
    () => getShopOrderStatusImpl(db, input),
    {
      properties: { organizationId: input.organizationId },
    }
  );
