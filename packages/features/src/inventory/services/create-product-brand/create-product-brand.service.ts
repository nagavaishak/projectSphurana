import {
  type ProductBrand,
  isUniqueViolation,
  productBrand,
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
  type CreateProductBrandInput,
  createProductBrandSchema,
} from './create-product-brand.schema.js';

const createProductBrandImpl = async (
  db: DbConnection,
  input: CreateProductBrandInput
): Promise<Result<ProductBrand>> => {
  const parsed = createProductBrandSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  try {
    const [row] = await withOrgScope(
      (tx) => tx.insert(productBrand).values(parsed.data).returning(),
      { db }
    );
    return ok(row);
  } catch (error) {
    // drizzle wraps the postgres.js error — the constraint lives on the
    // `.cause` chain, not `error.message` (see isUniqueViolation).
    if (isUniqueViolation(error, 'product_brand_org_name_unique')) {
      return err(
        new FeatureError(
          ErrorCodes.ALREADY_EXISTS,
          'A product brand with this name already exists'
        )
      );
    }
    logError('inventory.createProductBrand', error, {
      feature: 'inventory',
      extra: { organizationId: input.organizationId, name: input.name },
    });
    return err(
      new FeatureError(
        ErrorCodes.INTERNAL_ERROR,
        'Failed to create product brand'
      )
    );
  }
};

export const createProductBrand = (
  db: DbConnection,
  input: CreateProductBrandInput
) =>
  trackedResult(
    'inventory.createProductBrand',
    () => createProductBrandImpl(db, input),
    {
      properties: { organizationId: input.organizationId },
    }
  );
