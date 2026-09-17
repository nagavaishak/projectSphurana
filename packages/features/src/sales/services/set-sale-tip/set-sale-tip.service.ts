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
import {
  loadSaleWithRelations,
  recomputeAndPersistTotals,
} from '../../utils/load-sale.js';
import { computeSaleTotals } from '../../utils/sale-totals.js';
import {
  type SetSaleTipInput,
  setSaleTipSchema,
} from './set-sale-tip.schema.js';

const setSaleTipImpl = async (
  db: DbConnection,
  input: SetSaleTipInput
): Promise<Result<SaleWithRelations>> => {
  const parsed = setSaleTipSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  const { organizationId, saleId, tipType, tipPercent, tipAmountCents } =
    parsed.data;

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
              'The tip can only be changed on an open sale'
            ),
          };
        }

        // Reducing/clearing a tip must not drop the total below what's already
        // settled (e.g. a customer who overpaid via tip, then the tip is
        // lowered) — that would strand the sale over-paid AND open.
        const succeededPaidCents = existing.payments
          .filter((p) => p.status === 'succeeded')
          .reduce((sum, p) => sum + p.amountCents, 0);
        if (succeededPaidCents > 0) {
          const prospective = computeSaleTotals(existing.items, {
            tipType,
            tipPercent: tipType === 'percent' ? (tipPercent ?? 0) : null,
            tipCents: tipType === 'amount' ? (tipAmountCents ?? 0) : 0,
          });
          if (prospective.totalCents < succeededPaidCents) {
            return {
              error: new FeatureError(
                ErrorCodes.INVALID_STATE,
                'Lowering the tip would drop the total below the amount already paid — refund a payment first'
              ),
            };
          }
        }

        await tx
          .update(sale)
          .set({
            tipType,
            tipPercent: tipType === 'percent' ? (tipPercent ?? 0) : null,
            tipCents: tipType === 'amount' ? (tipAmountCents ?? 0) : 0,
            updatedAt: new Date(),
          })
          .where(eq(sale.id, saleId));

        // recompute derives percent tips from tip_percent and keeps
        // tip_cents as the settled source of truth
        const updated = await recomputeAndPersistTotals(tx, {
          ...existing,
          tipType,
          tipPercent: tipType === 'percent' ? (tipPercent ?? 0) : null,
          tipCents: tipType === 'amount' ? (tipAmountCents ?? 0) : 0,
        });
        return { updated };
      },
      { db }
    );

    if (result.error) return err(result.error);
    return ok(result.updated as SaleWithRelations);
  } catch (error) {
    logError('sales.setSaleTip', error, {
      feature: 'sales',
      extra: { organizationId, saleId, tipType },
    });
    return err(
      new FeatureError(ErrorCodes.INTERNAL_ERROR, 'Failed to set sale tip')
    );
  }
};

export const setSaleTip = (db: DbConnection, input: SetSaleTipInput) =>
  trackedResult('sales.setSaleTip', () => setSaleTipImpl(db, input), {
    properties: {
      organizationId: input.organizationId,
      saleId: input.saleId,
      tipType: input.tipType,
    },
  });

export type SetSaleTipResult = Awaited<ReturnType<typeof setSaleTip>>;
