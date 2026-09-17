import {
  type Supplier,
  supplier,
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
  type ListSuppliersInput,
  listSuppliersSchema,
} from './list-suppliers.schema.js';

const listSuppliersImpl = async (
  db: DbConnection,
  input: ListSuppliersInput
): Promise<Result<Supplier[]>> => {
  const parsed = listSuppliersSchema.safeParse(input);
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
        tx.query.supplier.findMany({
          where: eq(supplier.organizationId, parsed.data.organizationId),
          orderBy: [asc(supplier.name)],
        }),
      { db }
    );

    return ok(rows);
  } catch (error) {
    logError('inventory.listSuppliers', error, {
      feature: 'inventory',
      extra: { organizationId: parsed.data.organizationId },
    });
    return err(
      new FeatureError(ErrorCodes.INTERNAL_ERROR, 'Failed to list suppliers')
    );
  }
};

export const listSuppliers = (db: DbConnection, input: ListSuppliersInput) =>
  trackedResult('inventory.listSuppliers', () => listSuppliersImpl(db, input), {
    properties: { organizationId: input.organizationId },
  });
