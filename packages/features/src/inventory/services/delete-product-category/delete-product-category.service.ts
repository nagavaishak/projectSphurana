import { productCategory, withOrgScope } from '@borradh-workspace/database';
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
  type DeleteProductCategoryInput,
  deleteProductCategorySchema,
} from './delete-product-category.schema.js';

const deleteProductCategoryImpl = async (
  db: DbConnection,
  input: DeleteProductCategoryInput
): Promise<Result<{ success: true }>> => {
  const parsed = deleteProductCategorySchema.safeParse(input);
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
          .delete(productCategory)
          .where(
            and(
              eq(productCategory.id, id),
              eq(productCategory.organizationId, organizationId)
            )
          )
          .returning(),
      { db }
    );

    if (!row) {
      return err(
        new FeatureError(ErrorCodes.NOT_FOUND, 'ProductCategory not found')
      );
    }

    return ok({ success: true });
  } catch (error) {
    logError('inventory.deleteProductCategory', error, {
      feature: 'inventory',
      extra: { organizationId, id },
    });
    return err(
      new FeatureError(
        ErrorCodes.INTERNAL_ERROR,
        'Failed to delete product category'
      )
    );
  }
};

export const deleteProductCategory = (
  db: DbConnection,
  input: DeleteProductCategoryInput
) =>
  trackedResult(
    'inventory.deleteProductCategory',
    () => deleteProductCategoryImpl(db, input),
    {
      properties: { organizationId: input.organizationId, id: input.id },
    }
  );
