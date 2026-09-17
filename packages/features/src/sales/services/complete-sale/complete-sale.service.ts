import {
  type Sale,
  giftCard,
  giftCardTransaction,
  lead,
  product,
  productStock,
  sale,
  saleItem,
  salePayment,
  withOrgScope,
} from '@borradh-workspace/database';
import { logError, trackedResult } from '@borradh-workspace/observability';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { generateUniqueGiftCardCode } from '../../../gift-cards/utils/generate-gift-card-code.js';
import { giftCardExpiryToDate } from '../../../gift-cards/utils/gift-card-expiry.js';
import {
  recordLeadConversion,
  recordLeadVisitAndSpend,
} from '../../../leads/index.js';
import { purchaseMembership } from '../../../memberships/index.js';
import { getOrgDefaults } from '../../../org-defaults/index.js';
import {
  type DbConnection,
  ErrorCodes,
  FeatureError,
  type Result,
  err,
  notDeleted,
  ok,
} from '../../../shared/index.js';
import { cancelPendingStripeTenders } from '../../utils/cancel-pending-stripe-tenders.js';
import { loadSaleWithRelations } from '../../utils/load-sale.js';
import {
  type CompleteSaleInput,
  completeSaleSchema,
} from './complete-sale.schema.js';

const MAX_CODE_ATTEMPTS = 5;

const completeSaleImpl = async (
  db: DbConnection,
  input: CompleteSaleInput
): Promise<Result<Sale>> => {
  const parsed = completeSaleSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  const { organizationId, saleId, createdById } = parsed.data;

  try {
    // Preflight (short read) BEFORE any Stripe I/O: only proceed when the sale
    // is open AND fully paid by SETTLED tenders. This is what makes it safe to
    // cancel any still-pending Stripe tender below — those tenders are then
    // provably surplus (the sale is already paid), never the one that would
    // have paid it.
    const preflight = await withOrgScope(
      (tx) => loadSaleWithRelations(tx, organizationId, saleId),
      { db }
    );
    if (!preflight) {
      return err(new FeatureError(ErrorCodes.NOT_FOUND, 'Sale not found'));
    }
    if (preflight.status !== 'open') {
      return err(
        new FeatureError(
          ErrorCodes.INVALID_STATE,
          'Only an open sale can be completed'
        )
      );
    }
    const preflightPaid = preflight.payments
      .filter((p) => p.status === 'succeeded')
      .reduce((sum, p) => sum + p.amountCents, 0);
    if (preflightPaid < preflight.totalCents) {
      return err(
        new FeatureError(ErrorCodes.INVALID_STATE, 'Sale is not fully paid')
      );
    }

    // Abandon the Stripe side of any still-pending tender BEFORE we mark it
    // failed in the completion txn — otherwise a late capture is lost money.
    // Best-effort; runs outside any transaction (Stripe I/O).
    await cancelPendingStripeTenders(db, organizationId, saleId);

    const result = await withOrgScope(
      (outerTx) =>
        outerTx.transaction(async (tx) => {
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
                'Only an open sale can be completed'
              ),
            };
          }

          const paidCents = existing.payments
            .filter((p) => p.status === 'succeeded')
            .reduce((sum, p) => sum + p.amountCents, 0);

          if (paidCents < existing.totalCents) {
            return {
              error: new FeatureError(
                ErrorCodes.INVALID_STATE,
                'Sale is not fully paid'
              ),
            };
          }

          // Gift card expiry is derived from the org's `gift_card_expiry`
          // setting at issue time (contract §1.1.8; 'never' → null).
          const orgDefaultsResult = await getOrgDefaults(tx, {
            organizationId,
          });
          const giftCardExpirySetting = orgDefaultsResult.success
            ? orgDefaultsResult.data.giftCardExpiry
            : 'never';

          // Issue gift cards for gift_card line items (contract: buying a gift
          // card is a normal sale line; the card is issued at completion).
          for (const item of existing.items) {
            if (item.itemType !== 'gift_card' || item.giftCardId) continue;

            // The card is issued at its FACE VALUE, which may exceed the price
            // charged on the sale (a manual discount — e.g. a €50 card sold for
            // €20). Falls back to the line total when no face value is set.
            const amount = item.giftCardFaceValueCents ?? item.totalCents;
            // Per-card expiry override wins over the org default.
            const expirySetting = item.giftCardExpiry ?? giftCardExpirySetting;
            // Resolve a collision-free code BEFORE inserting. A post-violation
            // retry on the same tx can never succeed — the first unique
            // violation aborts the transaction (L3).
            const code = await generateUniqueGiftCardCode(
              tx,
              organizationId,
              MAX_CODE_ATTEMPTS
            );
            const [issued] = await tx
              .insert(giftCard)
              .values({
                organizationId,
                code,
                initialAmountCents: amount,
                balanceCents: amount,
                currency: existing.currency,
                // Derived from org_defaults.gift_card_expiry (contract
                // §1.1.8); 'never' → null.
                expiresAt: giftCardExpiryToDate(expirySetting, new Date()),
                leadId: existing.leadId,
                saleItemId: item.id,
              })
              .returning();
            if (!issued) {
              throw new Error('Failed to issue gift card');
            }

            await tx.insert(giftCardTransaction).values({
              giftCardId: issued.id,
              type: 'issue',
              amountCents: amount,
              saleId,
              createdById: createdById ?? null,
            });
            await tx
              .update(saleItem)
              .set({ giftCardId: issued.id, updatedAt: new Date() })
              .where(eq(saleItem.id, item.id));
          }

          // The sale is settled by its succeeded tenders. Any still-pending
          // tender (an unscanned QR link / uncollected terminal intent) is now
          // abandoned — mark it failed so it doesn't linger as an open payment.
          await tx
            .update(salePayment)
            .set({ status: 'failed', updatedAt: new Date() })
            .where(
              and(
                eq(salePayment.saleId, saleId),
                eq(salePayment.status, 'pending')
              )
            );

          // Decrement product stock for tracked products at the sale's
          // location, inside the completion txn so stock movement commits
          // atomically with the sale. Only tracked products with a stock-
          // capable location move; oversell drives the row negative (allowed).
          const productLines = existing.items.filter(
            (i) => i.itemType === 'product' && i.productId != null
          );
          // A sale with no branch cannot move stock — `product_stock` is held
          // per branch, so there is no row to decrement. That is a real state
          // (legacy sales predating the location backfill, and appointments
          // that were never filed to a branch), but it must not pass in
          // SILENCE: the customer has paid and the shelf is now wrong, and
          // nothing anywhere said so. Surfaced rather than fixed here —
          // guessing a branch would put the movement on the wrong shelf.
          if (productLines.length > 0 && !existing.locationId) {
            logError(
              'sales.completeSale.stockSkippedNoLocation',
              new Error('Sale has no location; product stock was not adjusted'),
              {
                feature: 'sales',
                extra: {
                  saleId: existing.id,
                  organizationId,
                  productLineCount: productLines.length,
                },
              }
            );
          }
          if (productLines.length > 0 && existing.locationId) {
            const locationId = existing.locationId;
            const productIds = [
              ...new Set(productLines.map((i) => i.productId as string)),
            ];
            const products = await tx.query.product.findMany({
              where: and(
                inArray(product.id, productIds),
                eq(product.organizationId, organizationId)
              ),
              columns: { id: true, trackStock: true },
            });
            const tracked = new Set(
              products.filter((p) => p.trackStock).map((p) => p.id)
            );
            for (const line of productLines) {
              const productId = line.productId as string;
              if (!tracked.has(productId)) continue;
              await tx
                .insert(productStock)
                .values({
                  productId,
                  locationId,
                  quantity: -line.quantity,
                })
                .onConflictDoUpdate({
                  target: [productStock.productId, productStock.locationId],
                  set: {
                    quantity: sql`${productStock.quantity} - ${line.quantity}`,
                    updatedAt: new Date(),
                  },
                });
            }
          }

          const [updated] = await tx
            .update(sale)
            .set({
              status: 'completed',
              completedAt: new Date(),
              updatedAt: new Date(),
            })
            .where(eq(sale.id, saleId))
            .returning();

          // Membership line items to provision after the sale is committed —
          // recurring plans hit Stripe, so provisioning must NOT run inside
          // this transaction (never hold a DB txn across external I/O).
          const membershipItems = existing.items
            .filter(
              (i) => i.itemType === 'membership' && i.membershipPlanId != null
            )
            .map((i) => ({
              saleItemId: i.id,
              planId: i.membershipPlanId as string,
            }));

          return { updated, membershipItems, leadId: existing.leadId };
        }),
      { db }
    );

    if (result.error) return err(result.error);

    // Provision memberships sold on this sale (contract §1.3.2): each becomes a
    // `lead_membership` row with `saleItemId` provenance. Runs after commit so
    // Stripe subscription creation for recurring plans is outside the txn.
    // Requires a client — a walk-in sale with no lead can't own a membership.
    const { membershipItems, leadId } = result;
    // Defensive: add-sale-item now rejects membership lines on a lead-less
    // sale, so this should be unreachable. Log loudly if it ever happens
    // rather than silently dropping a paid membership (M2).
    if (membershipItems.length > 0 && !leadId) {
      logError(
        'sales.completeSale.membershipWithoutLead',
        new Error(
          'Membership line items on a lead-less sale were skipped at completion'
        ),
        {
          feature: 'sales',
          extra: {
            organizationId,
            saleId,
            membershipItemCount: membershipItems.length,
          },
        }
      );
    }
    if (membershipItems.length > 0 && leadId) {
      for (const membershipItem of membershipItems) {
        const membershipResult = await purchaseMembership(db, {
          organizationId,
          leadId,
          planId: membershipItem.planId,
          saleItemId: membershipItem.saleItemId,
        });
        if (!membershipResult.success) {
          // Best-effort: the sale is already completed and paid. Surface the
          // failure in logs rather than rolling back a captured payment.
          logError(
            'sales.completeSale.provisionMembership',
            new Error(membershipResult.error.message),
            {
              feature: 'sales',
              extra: {
                organizationId,
                saleId,
                saleItemId: membershipItem.saleItemId,
                code: membershipResult.error.code,
              },
            }
          );
        }
      }
    }

    // Post-commit: a completed sale converts its client (Booked = customer) and
    // updates their lifetime value + last visit. Best-effort — the payment is
    // captured and the sale committed; a stage-write failure must never roll
    // that back. A walk-in sale with no lead (`leadId` null) simply skips.
    if (leadId) {
      try {
        const soldCents = result.updated.totalCents;
        await withOrgScope(
          async (tx) => {
            const leadRow = await tx.query.lead.findFirst({
              where: and(
                eq(lead.id, leadId),
                eq(lead.organizationId, organizationId),
                notDeleted(lead)
              ),
            });
            if (!leadRow) return;
            await recordLeadConversion(tx, {
              leadId: leadRow.id,
              organizationId,
              activityType: 'sale_completed',
              activityDescription: 'Completed a paid sale',
            });
            // Spend + visit are recorded on EVERY completed sale, not just the
            // converting one — a repeat customer's lifetime value keeps growing
            // after `converted_at` has been stamped. Delegated to the leads
            // feature so the `lead` table keeps one owning writer.
            await recordLeadVisitAndSpend(tx, {
              leadId: leadRow.id,
              organizationId,
              addSpendCents: soldCents,
            });
          },
          { db }
        );
      } catch (error) {
        logError('sales.completeSale.convertLead', error, {
          feature: 'sales',
          extra: { organizationId, saleId },
        });
      }
    }

    return ok(result.updated as Sale);
  } catch (error) {
    logError('sales.completeSale', error, {
      feature: 'sales',
      extra: { organizationId, saleId },
    });
    return err(
      new FeatureError(ErrorCodes.INTERNAL_ERROR, 'Failed to complete sale')
    );
  }
};

export const completeSale = (db: DbConnection, input: CompleteSaleInput) =>
  trackedResult('sales.completeSale', () => completeSaleImpl(db, input), {
    properties: {
      organizationId: input.organizationId,
      saleId: input.saleId,
    },
  });

export type CompleteSaleResult = Awaited<ReturnType<typeof completeSale>>;
