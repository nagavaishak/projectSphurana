import { supplier, withOrgScope } from '@borradh-workspace/database';
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
  type DeleteSupplierInput,
  deleteSupplierSchema,
} from './delete-supplier.schema.js';

const deleteSupplierImpl = async (
  db: DbConnection,
  input: DeleteSupplierInput
): Promise<Result<{ success: true }>> => {
  const parsed = deleteSupplierSchema.safeParse(input);
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
          .delete(supplier)
          .where(
            and(
              eq(supplier.id, id),
              eq(supplier.organizationId, organizationId)
            )
          )
          .returning(),
      { db }
    );

    if (!row) {
      return err(new FeatureError(ErrorCodes.NOT_FOUND, 'Supplier not found'));
    }

    return ok({ success: true });
  } catch (error) {
    logError('inventory.deleteSupplier', error, {
      feature: 'inventory',
      extra: { organizationId, id },
    });
    return err(
      new FeatureError(ErrorCodes.INTERNAL_ERROR, 'Failed to delete supplier')
    );
  }
};

export const deleteSupplier = (db: DbConnection, input: DeleteSupplierInput) =>
  trackedResult(
    'inventory.deleteSupplier',
    () => deleteSupplierImpl(db, input),
    {
      properties: { organizationId: input.organizationId, id: input.id },
    }
  );
