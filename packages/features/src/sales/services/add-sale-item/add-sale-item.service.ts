import {
  membershipPlan,
  saleItem,
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
import type { SaleWithRelations } from '../../models/sale.types.js';
import {
  loadSaleWithRelations,
  recomputeAndPersistTotals,
} from '../../utils/load-sale.js';
import {
  type AddSaleItemInput,
  addSaleItemSchema,
} from './add-sale-item.schema.js';

const addSaleItemImpl = async (
  db: DbConnection,
  input: AddSaleItemInput
): Promise<Result<SaleWithRelations>> => {
  const parsed = addSaleItemSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  const { organizationId, saleId, quantity, unitPriceCents } = parsed.data;

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
              'Items can only be added to an open sale'
            ),
          };
        }

        if (parsed.data.itemType === 'membership') {
          // A membership can only be provisioned to a client (lead). A walk-in
          // (lead-less) sale can't own a membership — reject here rather than
          // silently dropping it at completion (M2).
          if (!existing.leadId) {
            return {
              error: new FeatureError(
                ErrorCodes.VALIDATION_ERROR,
                'A membership can only be sold to a client — add a client to the sale first'
              ),
            };
          }

          // Provisioning at completion runs ONCE per line, ignoring quantity —
          // so a membership line must be a single unit (M-quantity). Sell N
          // memberships as N separate lines.
          if (quantity > 1) {
            return {
              error: new FeatureError(
                ErrorCodes.VALIDATION_ERROR,
                'A membership must be sold one at a time — add it as separate lines'
              ),
            };
          }

          // The line price must match the plan's price — never trust a
          // client-supplied unit price for a membership.
          if (!parsed.data.membershipPlanId) {
            return {
              error: new FeatureError(
                ErrorCodes.VALIDATION_ERROR,
                'A membership line requires a membership plan'
              ),
            };
          }
          const plan = await tx.query.membershipPlan.findFirst({
            where: and(
              eq(membershipPlan.id, parsed.data.membershipPlanId),
              eq(membershipPlan.organizationId, organizationId)
            ),
          });
          if (!plan) {
            return {
              error: new FeatureError(
                ErrorCodes.NOT_FOUND,
                'Membership plan not found'
              ),
            };
          }
          if (unitPriceCents !== plan.priceCents) {
            return {
              error: new FeatureError(
                ErrorCodes.VALIDATION_ERROR,
                'Membership price does not match the plan price'
              ),
            };
          }
        }

        await tx.insert(saleItem).values({
          saleId,
          itemType: parsed.data.itemType,
          appointmentId: parsed.data.appointmentId ?? null,
          serviceId: parsed.data.serviceId ?? null,
          productId: parsed.data.productId ?? null,
          membershipPlanId: parsed.data.membershipPlanId ?? null,
          practitionerId: parsed.data.practitionerId ?? null,
          name: parsed.data.name,
          quantity,
          unitPriceCents,
          totalCents: quantity * unitPriceCents,
          giftCardFaceValueCents: parsed.data.giftCardFaceValueCents ?? null,
          giftCardExpiry: parsed.data.giftCardExpiry ?? null,
        });

        const updated = await recomputeAndPersistTotals(tx, existing);
        return { updated };
      },
      { db }
    );

    if (result.error) return err(result.error);
    return ok(result.updated as SaleWithRelations);
  } catch (error) {
    logError('sales.addSaleItem', error, {
      feature: 'sales',
      extra: { organizationId, saleId, itemType: parsed.data.itemType },
    });
    return err(
      new FeatureError(ErrorCodes.INTERNAL_ERROR, 'Failed to add sale item')
    );
  }
};

export const addSaleItem = (db: DbConnection, input: AddSaleItemInput) =>
  trackedResult('sales.addSaleItem', () => addSaleItemImpl(db, input), {
    properties: {
      organizationId: input.organizationId,
      saleId: input.saleId,
      itemType: input.itemType,
    },
  });

export type AddSaleItemResult = Awaited<ReturnType<typeof addSaleItem>>;
