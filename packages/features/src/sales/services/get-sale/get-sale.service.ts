import { withOrgScope } from '@borradh-workspace/database';
import { trackedResult } from '@borradh-workspace/observability';
import {
  type DbConnection,
  ErrorCodes,
  FeatureError,
  type Result,
  err,
  ok,
} from '../../../shared/index.js';
import type { SaleWithRelations } from '../../models/sale.types.js';
import { loadSaleWithRelations } from '../../utils/load-sale.js';
import { type GetSaleInput, getSaleSchema } from './get-sale.schema.js';

const getSaleImpl = async (
  db: DbConnection,
  input: GetSaleInput
): Promise<Result<SaleWithRelations>> => {
  const parsed = getSaleSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  const { organizationId, saleId } = parsed.data;

  const result = await withOrgScope(
    (tx) => loadSaleWithRelations(tx, organizationId, saleId),
    { db }
  );

  if (!result) {
    return err(new FeatureError(ErrorCodes.NOT_FOUND, 'Sale not found'));
  }

  return ok(result);
};

export const getSale = (db: DbConnection, input: GetSaleInput) =>
  trackedResult('sales.getSale', () => getSaleImpl(db, input), {
    properties: {
      organizationId: input.organizationId,
      saleId: input.saleId,
    },
    internalErrorsOnly: true,
  });

export type GetSaleResult = Awaited<ReturnType<typeof getSale>>;
