import {
  type ProductCategory,
  productCategory,
  withOrgScope,
} from '@borradh-workspace/database';
import { logError, trackedResult } from '@borradh-workspace/observability';
import { asc, eq } from 'drizzle-orm';
import {
  type DbConnection,
  ErrorCodes,
  FeatureError,
  type Result,
  err,
  ok,
} from '../../../shared/index.js';
import {
  type ListProductCategoriesInput,
  listProductCategoriesSchema,
} from './list-product-categories.schema.js';

const listProductCategoriesImpl = async (
  db: DbConnection,
  input: ListProductCategoriesInput
): Promise<Result<ProductCategory[]>> => {
  const parsed = listProductCategoriesSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  try {
    const rows = await withOrgScope(
      (tx) =>
        tx.query.productCategory.findMany({
          where: eq(productCategory.organizationId, parsed.data.organizationId),
          orderBy: [asc(productCategory.name)],
        }),
      { db }
    );

    return ok(rows);
  } catch (error) {
    logError('inventory.listProductCategories', error, {
      feature: 'inventory',
      extra: { organizationId: parsed.data.organizationId },
    });
    return err(
      new FeatureError(
        ErrorCodes.INTERNAL_ERROR,
        'Failed to list product categories'
      )
    );
  }
};

export const listProductCategories = (
  db: DbConnection,
  input: ListProductCategoriesInput
) =>
  trackedResult(
    'inventory.listProductCategories',
    () => listProductCategoriesImpl(db, input),
    {
      properties: { organizationId: input.organizationId },
    }
  );
