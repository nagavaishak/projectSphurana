import {
  type ProductStock,
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
  type ListProductStockInput,
  listProductStockSchema,
} from './list-product-stock.schema.js';

const listProductStockImpl = async (
  db: DbConnection,
  input: ListProductStockInput
): Promise<Result<ProductStock[]>> => {
  const parsed = listProductStockSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  const { productId, organizationId } = parsed.data;

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

        const rows = await tx.query.productStock.findMany({
          where: eq(productStock.productId, productId),
        });

        return ok(rows);
      },
      { db }
    );
  } catch (error) {
    logError('inventory.listProductStock', error, {
      feature: 'inventory',
      extra: { organizationId, productId },
    });
    return err(
      new FeatureError(ErrorCodes.INTERNAL_ERROR, 'Failed to list stock')
    );
  }
};

export const listProductStock = (
  db: DbConnection,
  input: ListProductStockInput
) =>
  trackedResult(
    'inventory.listProductStock',
    () => listProductStockImpl(db, input),
    {
      properties: {
        organizationId: input.organizationId,
        productId: input.productId,
      },
      internalErrorsOnly: true,
    }
  );
