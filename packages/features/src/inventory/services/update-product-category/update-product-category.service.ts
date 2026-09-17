import {
  type ProductCategory,
  isUniqueViolation,
  productCategory,
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
  type UpdateProductCategoryInput,
  updateProductCategorySchema,
} from './update-product-category.schema.js';

const updateProductCategoryImpl = async (
  db: DbConnection,
  input: UpdateProductCategoryInput
): Promise<Result<ProductCategory>> => {
  const parsed = updateProductCategorySchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  const { id, organizationId, ...updates } = parsed.data;

  try {
    const [row] = await withOrgScope(
      (tx) =>
        tx
          .update(productCategory)
          .set(updates)
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

    return ok(row);
  } catch (error) {
    // drizzle wraps the postgres.js error — the constraint lives on the
    // `.cause` chain, not `error.message` (see isUniqueViolation).
    if (isUniqueViolation(error, 'product_category_org_name_unique')) {
      return err(
        new FeatureError(
          ErrorCodes.ALREADY_EXISTS,
          'A product category with this name already exists'
        )
      );
    }
    logError('inventory.updateProductCategory', error, {
      feature: 'inventory',
      extra: { organizationId, id },
    });
    return err(
      new FeatureError(
        ErrorCodes.INTERNAL_ERROR,
        'Failed to update product category'
      )
    );
  }
};

export const updateProductCategory = (
  db: DbConnection,
  input: UpdateProductCategoryInput
) =>
  trackedResult(
    'inventory.updateProductCategory',
    () => updateProductCategoryImpl(db, input),
    {
      properties: { organizationId: input.organizationId, id: input.id },
    }
  );
