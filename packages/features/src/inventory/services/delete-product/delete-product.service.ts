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
  type DeleteProductInput,
  deleteProductSchema,
} from './delete-product.schema.js';

/**
 * Soft delete: products may be referenced by stock order / stock take history
 * (restrict FKs), so deletion deactivates instead of removing the row.
 */
const deleteProductImpl = async (
  db: DbConnection,
  input: DeleteProductInput
): Promise<Result<Product>> => {
  const parsed = deleteProductSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  const { id, organizationId } = parsed.data;

  try {
    const [row] = await withOrgScope(
      (tx) =>
        tx
          .update(product)
          .set({ isActive: false })
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
    logError('inventory.deleteProduct', error, {
      feature: 'inventory',
      extra: { organizationId, id },
    });
    return err(
      new FeatureError(ErrorCodes.INTERNAL_ERROR, 'Failed to delete product')
    );
  }
};

export const deleteProduct = (db: DbConnection, input: DeleteProductInput) =>
  trackedResult('inventory.deleteProduct', () => deleteProductImpl(db, input), {
    properties: { organizationId: input.organizationId, id: input.id },
  });
