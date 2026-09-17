import {
  type ProductBrand,
  isUniqueViolation,
  productBrand,
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
  type UpdateProductBrandInput,
  updateProductBrandSchema,
} from './update-product-brand.schema.js';

const updateProductBrandImpl = async (
  db: DbConnection,
  input: UpdateProductBrandInput
): Promise<Result<ProductBrand>> => {
  const parsed = updateProductBrandSchema.safeParse(input);
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
          .update(productBrand)
          .set(updates)
          .where(
            and(
              eq(productBrand.id, id),
              eq(productBrand.organizationId, organizationId)
            )
          )
          .returning(),
      { db }
    );

    if (!row) {
      return err(
        new FeatureError(ErrorCodes.NOT_FOUND, 'ProductBrand not found')
      );
    }

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
    logError('inventory.updateProductBrand', error, {
      feature: 'inventory',
      extra: { organizationId, id },
    });
    return err(
      new FeatureError(
        ErrorCodes.INTERNAL_ERROR,
        'Failed to update product brand'
      )
    );
  }
};

export const updateProductBrand = (
  db: DbConnection,
  input: UpdateProductBrandInput
) =>
  trackedResult(
    'inventory.updateProductBrand',
    () => updateProductBrandImpl(db, input),
    {
      properties: { organizationId: input.organizationId, id: input.id },
    }
  );
