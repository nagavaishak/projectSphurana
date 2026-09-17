import {
  type Product,
  isUniqueViolation,
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
  type UpdateProductInput,
  updateProductSchema,
} from './update-product.schema.js';

const updateProductImpl = async (
  db: DbConnection,
  input: UpdateProductInput
): Promise<Result<Product>> => {
  const parsed = updateProductSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  const { id, organizationId, ...updates } = parsed.data;

  if (Object.keys(updates).length === 0) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'No fields to update')
    );
  }

  try {
    const [row] = await withOrgScope(
      (tx) =>
        tx
          .update(product)
          .set(updates)
          .where(
            and(eq(product.id, id), eq(product.organizationId, organizationId))
          )
          .returning(),
      { db }
    );

    if (!row) {
      return err(new FeatureError(ErrorCodes.NOT_FOUND, 'Product not found'));
    }

    return ok(row);
  } catch (error) {
    // drizzle wraps the postgres.js error — the constraint lives on the
    // `.cause` chain, not `error.message` (see isUniqueViolation).
    if (isUniqueViolation(error, 'product_org_barcode_unique')) {
      return err(
        new FeatureError(
          ErrorCodes.ALREADY_EXISTS,
          'A product with this barcode already exists'
        )
      );
    }
    logError('inventory.updateProduct', error, {
      feature: 'inventory',
      extra: { organizationId, id },
    });
    return err(
      new FeatureError(ErrorCodes.INTERNAL_ERROR, 'Failed to update product')
    );
  }
};

export const updateProduct = (db: DbConnection, input: UpdateProductInput) =>
  trackedResult('inventory.updateProduct', () => updateProductImpl(db, input), {
    properties: { organizationId: input.organizationId, id: input.id },
  });
