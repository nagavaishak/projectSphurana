import { sale, withOrgScope } from '@borradh-workspace/database';
import { logError, trackedResult } from '@borradh-workspace/observability';
import { eq } from 'drizzle-orm';
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
import {
  type SetSaleClientInput,
  setSaleClientSchema,
} from './set-sale-client.schema.js';

const setSaleClientImpl = async (
  db: DbConnection,
  input: SetSaleClientInput
): Promise<Result<SaleWithRelations>> => {
  const parsed = setSaleClientSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  const { organizationId, saleId, leadId } = parsed.data;

  try {
    const result = await withOrgScope(
      async (tx) => {
        const existing = await loadSaleWithRelations(
          tx,
          organizationId,
          saleId
        );
        if (!existing) {
          return {
            error: new FeatureError(ErrorCodes.NOT_FOUND, 'Sale not found'),
          };
        }
        if (existing.status !== 'open') {
          return {
            error: new FeatureError(
              ErrorCodes.INVALID_STATE,
              'The client can only be changed on an open sale'
            ),
          };
        }

        // Attaching a client: the lead must belong to this org.
        if (leadId) {
          const found = await tx.query.lead.findFirst({
            where: (t, { and: andOp, eq: eqOp }) =>
              andOp(eqOp(t.id, leadId), eqOp(t.organizationId, organizationId)),
            columns: { id: true },
          });
          if (!found) {
            return {
              error: new FeatureError(ErrorCodes.NOT_FOUND, 'Client not found'),
            };
          }
        }

        await tx
          .update(sale)
          .set({ leadId: leadId ?? null, updatedAt: new Date() })
          .where(eq(sale.id, saleId));

        const updated = await loadSaleWithRelations(tx, organizationId, saleId);
        return { updated };
      },
      { db }
    );

    if (result.error) return err(result.error);
    return ok(result.updated as SaleWithRelations);
  } catch (error) {
    logError('sales.setSaleClient', error, {
      feature: 'sales',
      extra: { organizationId, saleId, leadId },
    });
    return err(
      new FeatureError(ErrorCodes.INTERNAL_ERROR, 'Failed to set sale client')
    );
  }
};

export const setSaleClient = (db: DbConnection, input: SetSaleClientInput) =>
  trackedResult('sales.setSaleClient', () => setSaleClientImpl(db, input), {
    properties: { organizationId: input.organizationId, saleId: input.saleId },
  });

export type SetSaleClientResult = Awaited<ReturnType<typeof setSaleClient>>;
