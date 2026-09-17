import {
  type Supplier,
  isUniqueViolation,
  supplier,
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
  type UpdateSupplierInput,
  updateSupplierSchema,
} from './update-supplier.schema.js';

const updateSupplierImpl = async (
  db: DbConnection,
  input: UpdateSupplierInput
): Promise<Result<Supplier>> => {
  const parsed = updateSupplierSchema.safeParse(input);
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
          .update(supplier)
          .set(updates)
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

    return ok(row);
  } catch (error) {
    // drizzle wraps the postgres.js error — the constraint lives on the
    // `.cause` chain, not `error.message` (see isUniqueViolation).
    if (isUniqueViolation(error, 'supplier_org_name_unique')) {
      return err(
        new FeatureError(
          ErrorCodes.ALREADY_EXISTS,
          'A supplier with this name already exists'
        )
      );
    }
    logError('inventory.updateSupplier', error, {
      feature: 'inventory',
      extra: { organizationId, id },
    });
    return err(
      new FeatureError(ErrorCodes.INTERNAL_ERROR, 'Failed to update supplier')
    );
  }
};

export const updateSupplier = (db: DbConnection, input: UpdateSupplierInput) =>
  trackedResult(
    'inventory.updateSupplier',
    () => updateSupplierImpl(db, input),
    {
      properties: { organizationId: input.organizationId, id: input.id },
    }
  );
