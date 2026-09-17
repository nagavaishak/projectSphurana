import {
  type Product,
  product,
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
  type GetProductInput,
  getProductSchema,
} from './get-product.schema.js';

const getProductImpl = async (
  db: DbConnection,
  input: GetProductInput
): Promise<Result<Product>> => {
  const parsed = getProductSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  try {
    const row = await withOrgScope(
      (tx) =>
        tx.query.product.findFirst({
          where: and(
            eq(product.id, parsed.data.id),
            eq(product.organizationId, parsed.data.organizationId)
          ),
        }),
      { db }
    );

    if (!row) {
      return err(new FeatureError(ErrorCodes.NOT_FOUND, 'Product not found'));
    }

    return ok(row);
  } catch (error) {
    logError('inventory.getProduct', error, {
      feature: 'inventory',
      extra: { organizationId: parsed.data.organizationId, id: parsed.data.id },
    });
    return err(
      new FeatureError(ErrorCodes.INTERNAL_ERROR, 'Failed to get product')
    );
  }
};

export const getProduct = (db: DbConnection, input: GetProductInput) =>
  trackedResult('inventory.getProduct', () => getProductImpl(db, input), {
    properties: { organizationId: input.organizationId, id: input.id },
    internalErrorsOnly: true,
  });
