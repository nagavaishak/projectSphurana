import {
  type ProductBrand,
  productBrand,
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
  type ListProductBrandsInput,
  listProductBrandsSchema,
} from './list-product-brands.schema.js';

const listProductBrandsImpl = async (
  db: DbConnection,
  input: ListProductBrandsInput
): Promise<Result<ProductBrand[]>> => {
  const parsed = listProductBrandsSchema.safeParse(input);
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
        tx.query.productBrand.findMany({
          where: eq(productBrand.organizationId, parsed.data.organizationId),
          orderBy: [asc(productBrand.name)],
        }),
      { db }
    );

    return ok(rows);
  } catch (error) {
    logError('inventory.listProductBrands', error, {
      feature: 'inventory',
      extra: { organizationId: parsed.data.organizationId },
    });
    return err(
      new FeatureError(
        ErrorCodes.INTERNAL_ERROR,
        'Failed to list product brands'
      )
    );
  }
};

export const listProductBrands = (
  db: DbConnection,
  input: ListProductBrandsInput
) =>
  trackedResult(
    'inventory.listProductBrands',
    () => listProductBrandsImpl(db, input),
    {
      properties: { organizationId: input.organizationId },
    }
  );
