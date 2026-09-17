import {
  type Supplier,
  isUniqueViolation,
  supplier,
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
  type CreateSupplierInput,
  createSupplierSchema,
} from './create-supplier.schema.js';

const createSupplierImpl = async (
  db: DbConnection,
  input: CreateSupplierInput
): Promise<Result<Supplier>> => {
  const parsed = createSupplierSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  try {
    const [row] = await withOrgScope(
      (tx) => tx.insert(supplier).values(parsed.data).returning(),
      { db }
    );
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
    logError('inventory.createSupplier', error, {
      feature: 'inventory',
      extra: { organizationId: input.organizationId, name: input.name },
    });
    return err(
      new FeatureError(ErrorCodes.INTERNAL_ERROR, 'Failed to create supplier')
    );
  }
};

export const createSupplier = (db: DbConnection, input: CreateSupplierInput) =>
  trackedResult(
    'inventory.createSupplier',
    () => createSupplierImpl(db, input),
    {
      properties: { organizationId: input.organizationId },
    }
  );
