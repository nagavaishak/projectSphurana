import { productBrand, withOrgScope } from '@borradh-workspace/database';
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
  type DeleteProductBrandInput,
  deleteProductBrandSchema,
} from './delete-product-brand.schema.js';

const deleteProductBrandImpl = async (
  db: DbConnection,
  input: DeleteProductBrandInput
): Promise<Result<{ success: true }>> => {
  const parsed = deleteProductBrandSchema.safeParse(input);
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
          .delete(productBrand)
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

    return ok({ success: true });
  } catch (error) {
    logError('inventory.deleteProductBrand', error, {
      feature: 'inventory',
      extra: { organizationId, id },
    });
    return err(
      new FeatureError(
        ErrorCodes.INTERNAL_ERROR,
        'Failed to delete product brand'
      )
    );
  }
};

export const deleteProductBrand = (
  db: DbConnection,
  input: DeleteProductBrandInput
) =>
  trackedResult(
    'inventory.deleteProductBrand',
    () => deleteProductBrandImpl(db, input),
    {
      properties: { organizationId: input.organizationId, id: input.id },
    }
  );
