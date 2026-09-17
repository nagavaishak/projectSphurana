import {
  type ProductCategory,
  isUniqueViolation,
  productCategory,
  withOrgScope,
} from '@borradh-workspace/database';
import { logError, trackedResult } from '@borradh-workspace/observability';
import {
  type DbConnection,
  ErrorCodes,
  FeatureError,
  type Result,
  err,
  ok,
} from '../../../shared/index.js';
import {
  type CreateProductCategoryInput,
  createProductCategorySchema,
} from './create-product-category.schema.js';

const createProductCategoryImpl = async (
  db: DbConnection,
  input: CreateProductCategoryInput
): Promise<Result<ProductCategory>> => {
  const parsed = createProductCategorySchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  try {
    const [row] = await withOrgScope(
      (tx) => tx.insert(productCategory).values(parsed.data).returning(),
      { db }
    );
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
    logError('inventory.createProductCategory', error, {
      feature: 'inventory',
      extra: { organizationId: input.organizationId, name: input.name },
    });
    return err(
      new FeatureError(
        ErrorCodes.INTERNAL_ERROR,
        'Failed to create product category'
      )
    );
  }
};

export const createProductCategory = (
  db: DbConnection,
  input: CreateProductCategoryInput
) =>
  trackedResult(
    'inventory.createProductCategory',
    () => createProductCategoryImpl(db, input),
    {
      properties: { organizationId: input.organizationId },
    }
  );
