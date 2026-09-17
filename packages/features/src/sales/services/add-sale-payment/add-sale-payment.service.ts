import {
  giftCard,
  giftCardTransaction,
  salePayment,
  withOrgScope,
} from '@borradh-workspace/database';
import { getStripeConnectService } from '@borradh-workspace/integrations/stripe';
import { logError, trackedResult } from '@borradh-workspace/observability';
import { and, eq, gte, sql } from 'drizzle-orm';
import {
  type DbConnection,
  ErrorCodes,
  FeatureError,
  type Result,
  addCents,
  cents,
  err,
  ok,
  subCents,
} from '../../../shared/index.js';
import type { SaleWithRelations } from '../../models/sale.types.js';
import { autoCompleteIfFullyPaid } from '../../utils/auto-complete-sale.js';
import { loadSaleWithRelations } from '../../utils/load-sale.js';
import {
  type AddSalePaymentInput,
  addSalePaymentSchema,
} from './add-sale-payment.schema.js';

export interface AddSalePaymentResult extends SaleWithRelations {
  /** QR self-checkout: the Stripe Payment Link URL to render as a QR code. */
  paymentLinkUrl?: string;
  /**
   * Card-terminal payments: PaymentIntent client secret for reader-driven
   * collect/confirm (Tap to Pay needs it client-side).
   */
  terminalClientSecret?: string;
  /**
   * Manual card entry: PaymentIntent client secret confirmed client-side with
   * Stripe Elements (keyed card form).
   */
  cardClientSecret?: string;
  /**
   * Connected account the client secret belongs to — the frontend loads
   * Stripe.js with `{ stripeAccount }` so Elements targets the right account.
   */
  connectedAccountId?: string;
  /**
   * Manual card entry: the pending `sale_payment` row id, so the frontend can
   * settle it as soon as Elements confirms (without waiting on the webhook).
   */
  salePaymentId?: string;
}

const addSalePaymentImpl = async (
  db: DbConnection,
  input: AddSalePaymentInput
): Promise<Result<AddSalePaymentResult>> => {
  const parsed = addSalePaymentSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  const {
    organizationId,
    saleId,
    method,
    amountCents,
    giftCardCode,
    readerType,
    createdById,
    autoComplete,
  } = parsed.data;

  try {
    // 1. Load + validate the sale (short transaction — no external I/O held)
    const existing = await withOrgScope(
      (tx) => loadSaleWithRelations(tx, organizationId, saleId),
      { db }
    );

    if (!existing) {
      return err(new FeatureError(ErrorCodes.NOT_FOUND, 'Sale not found'));
    }
    if (existing.status !== 'open') {
      return err(
        new FeatureError(
          ErrorCodes.INVALID_STATE,
          'Payments can only be added to an open sale'
        )
      );
    }

    // 1b. Clamp non-cash tenders to the sale's remaining balance. The client
    // supplies `amountCents`; never trust it to exceed what's owed for a
    // captured tender. Cash MAY exceed (change is given back).
    //
    // The balance counts ONLY captured money (succeeded tenders) — never
    // in-flight intents. A pending card/QR row is an uncollected attempt, not
    // money owed against; letting it hold the balance is what made switching
    // methods (show a QR, then choose manual card) fail with "exceeds the
    // remaining balance". Two attempts may now coexist; if more than one is
    // actually captured, the surplus is auto-refunded at settlement (see
    // handle-sale-payment-webhook / settle-card-payment), which is the only
    // safe point to reconcile — Stripe can't un-capture on request.
    // Money math flows through the branded `Cents` helpers so a stray float or
    // a raw `+` on money becomes a type error. `p.amountCents` / `totalCents`
    // are still plain `number`s from the DB (TODO(branded): brand those columns
    // too), so we brand them at the boundary with `cents(...)`.
    const paidCents = existing.payments
      .filter((p) => p.status === 'succeeded')
      .reduce((sum, p) => addCents(sum, cents(p.amountCents)), cents(0));
    const remainingCents = subCents(cents(existing.totalCents), paidCents);

    if (method !== 'cash' && amountCents > remainingCents) {
      return err(
        new FeatureError(
          ErrorCodes.VALIDATION_ERROR,
          'Payment amount exceeds the remaining balance on this sale'
        )
      );
    }

    // 2. Method-specific handling
    if (method === 'gift_card') {
      // Redeem atomically: payment row + negative ledger row + balance update.
      // A real `tx.transaction` wraps the writes so they are atomic REGARDLESS
      // of the RLS flag — with RLS off, `withOrgScope` is a pass-through with no
      // transaction, so the balance decrement + ledger insert would otherwise
      // not be a single commit. Under RLS on this nests as a savepoint on the
      // already-scoped connection.
      const redeemResult = await withOrgScope(
        (outerTx) =>
          outerTx.transaction(async (tx) => {
            const card = await tx.query.giftCard.findFirst({
              where: (t, { and: andOp, eq: eqOp }) =>
                andOp(
                  eqOp(t.organizationId, organizationId),
                  eqOp(t.code, giftCardCode as string)
                ),
            });

            if (!card) {
              return {
                error: new FeatureError(
                  ErrorCodes.NOT_FOUND,
                  'Gift card not found'
                ),
              };
            }
            if (card.expiresAt && card.expiresAt < new Date()) {
              return {
                error: new FeatureError(
                  ErrorCodes.INVALID_STATE,
                  'Gift card has expired'
                ),
              };
            }
            // Gift card and sale must be in the same currency — redeeming a
            // €-card against a £-sale would silently mis-value the tender.
            if (card.currency !== existing.currency) {
              return {
                error: new FeatureError(
                  ErrorCodes.INVALID_STATE,
                  'Gift card currency does not match the sale'
                ),
              };
            }

            // Atomic, race-safe decrement: the conditional WHERE guarantees we
            // never drive the balance negative even under concurrent redeems.
            // 0 rows affected ⇒ insufficient balance (or a concurrent redeem
            // won the race). This replaces a read-then-write.
            const decremented = await tx
              .update(giftCard)
              .set({
                balanceCents: sql`${giftCard.balanceCents} - ${amountCents}`,
                updatedAt: new Date(),
              })
              .where(
                and(
                  eq(giftCard.id, card.id),
                  gte(giftCard.balanceCents, amountCents)
                )
              )
              .returning({ id: giftCard.id });

            if (decremented.length === 0) {
              return {
                error: new FeatureError(
                  ErrorCodes.INVALID_STATE,
                  'Insufficient gift card balance'
                ),
              };
            }

            await tx.insert(salePayment).values({
              saleId,
              method: 'gift_card',
              amountCents,
              status: 'succeeded',
              giftCardId: card.id,
            });
            await tx.insert(giftCardTransaction).values({
              giftCardId: card.id,
              type: 'redeem',
              amountCents: -amountCents,
              saleId,
              createdById: createdById ?? null,
            });

            const updated = await loadSaleWithRelations(
              tx,
              organizationId,
              saleId
            );
            return { updated };
          }),
        { db }
      );

      if (redeemResult.error) return err(redeemResult.error);
      // A gift-card redemption settles instantly; complete the sale if it now
      // covers the total so it doesn't linger as an open draft — unless the
      // caller opted out (interactive checkout confirms completion manually).
      const completed = autoComplete
        ? await autoCompleteIfFullyPaid(db, {
            organizationId,
            saleId,
            createdById,
          })
        : null;
      return ok((completed ?? redeemResult.updated) as AddSalePaymentResult);
    }

    if (method === 'cash') {
      const updated = await withOrgScope(
        async (tx) => {
          await tx.insert(salePayment).values({
            saleId,
            method,
            amountCents,
            status: 'succeeded',
          });
          return loadSaleWithRelations(tx, organizationId, saleId);
        },
        { db }
      );
      // Cash settles instantly; auto-complete once the sale is fully paid so it
      // surfaces on the Sales list without a manual "Complete sale" click —
      // unless the caller opted out (interactive checkout confirms manually).
      const completed = autoComplete
        ? await autoCompleteIfFullyPaid(db, {
            organizationId,
            saleId,
            createdById,
          })
        : null;
      return ok((completed ?? updated) as AddSalePaymentResult);
    }

    // Stripe-backed tenders need the connected account
    const integration = await withOrgScope(
      (tx) =>
        tx.query.stripeConnectIntegration.findFirst({
          where: (t, { eq: eqOp }) => eqOp(t.organizationId, organizationId),
        }),
      { db }
    );

    if (!integration || !integration.isActive) {
      return err(
        new FeatureError(
          ErrorCodes.INVALID_STATE,
          'Stripe is not connected for this organization'
        )
      );
    }
    if (!integration.chargesEnabled) {
      return err(
        new FeatureError(
          ErrorCodes.INVALID_STATE,
          'Stripe account cannot accept payments yet. Complete your Stripe onboarding first.'
        )
      );
    }

    const stripeConnect = getStripeConnectService();

    if (method === 'card_terminal') {
      // Insert the pending row FIRST so we have its id to thread into the
      // PaymentIntent metadata — the connect webhook settles the row by
      // `metadata.salePaymentId` (fallback: `stripe_payment_intent_id`). Short
      // write; no external I/O held.
      const inserted = await withOrgScope(
        async (tx) => {
          const [row] = await tx
            .insert(salePayment)
            .values({
              saleId,
              method: 'card_terminal',
              amountCents,
              status: 'pending',
              readerType: readerType ?? null,
            })
            .returning();
          return row;
        },
        { db }
      );

      // External call OUTSIDE any transaction — never hold a pooled
      // connection across Stripe I/O
      const paymentIntent = await stripeConnect.createTerminalPaymentIntent({
        connectedAccountId: integration.stripeAccountId,
        amountCents,
        currency: existing.currency,
        // Deterministic key off the pending row id so a retried create reuses
        // the same PaymentIntent instead of double-charging.
        idempotencyKey: `sale-payment-terminal:${inserted.id}`,
        metadata: {
          type: 'sale_payment',
          salePaymentId: inserted.id,
          saleId,
          organizationId,
        },
      });

      const updated = await withOrgScope(
        async (tx) => {
          await tx
            .update(salePayment)
            .set({
              stripePaymentIntentId: paymentIntent.id,
              updatedAt: new Date(),
            })
            .where(eq(salePayment.id, inserted.id));
          return loadSaleWithRelations(tx, organizationId, saleId);
        },
        { db }
      );

      return ok({
        ...(updated as SaleWithRelations),
        terminalClientSecret: paymentIntent.clientSecret,
      });
    }

    if (method === 'manual_card') {
      // Same pattern as card_terminal: pending row first (so its id rides in
      // the PI metadata for the webhook), then create the card PaymentIntent
      // outside any transaction. The keyed card form confirms it client-side.
      const inserted = await withOrgScope(
        async (tx) => {
          const [row] = await tx
            .insert(salePayment)
            .values({
              saleId,
              method: 'manual_card',
              amountCents,
              status: 'pending',
            })
            .returning();
          return row;
        },
        { db }
      );

      const paymentIntent = await stripeConnect.createCardPaymentIntent({
        connectedAccountId: integration.stripeAccountId,
        amountCents,
        currency: existing.currency,
        // Deterministic key off the pending row id so a retried create reuses
        // the same PaymentIntent instead of double-charging.
        idempotencyKey: `sale-payment-card:${inserted.id}`,
        metadata: {
          type: 'sale_payment',
          salePaymentId: inserted.id,
          saleId,
          organizationId,
        },
      });

      const updated = await withOrgScope(
        async (tx) => {
          await tx
            .update(salePayment)
            .set({
              stripePaymentIntentId: paymentIntent.id,
              updatedAt: new Date(),
            })
            .where(eq(salePayment.id, inserted.id));
          return loadSaleWithRelations(tx, organizationId, saleId);
        },
        { db }
      );

      return ok({
        ...(updated as SaleWithRelations),
        cardClientSecret: paymentIntent.clientSecret,
        connectedAccountId: integration.stripeAccountId,
        salePaymentId: inserted.id,
      });
    }

    // method === 'qr_self_checkout' — Stripe Payment Link rendered as a QR
    const inserted = await withOrgScope(
      async (tx) => {
        const [row] = await tx
          .insert(salePayment)
          .values({
            saleId,
            method: 'qr_self_checkout',
            amountCents,
            status: 'pending',
          })
          .returning();
        return row;
      },
      { db }
    );

    const paymentLink = await stripeConnect.createPaymentLink({
      connectedAccountId: integration.stripeAccountId,
      amountCents,
      currency: existing.currency,
      productName: 'Sale payment',
      // One-off POS tender: the link deactivates after a single completed
      // checkout so the customer can't scan and pay the same sale twice.
      singleUse: true,
      // Deterministic key off the pending row id so a retried create reuses the
      // same payment link instead of minting a duplicate.
      idempotencyKey: `sale-payment-qr:${inserted.id}`,
      metadata: {
        type: 'sale_payment',
        salePaymentId: inserted.id,
        saleId,
        organizationId,
      },
    });

    const updated = await withOrgScope(
      async (tx) => {
        // Persist the Payment Link id so an abandoned QR (cashier switches
        // methods, or completes/voids the sale another way) can be deactivated —
        // the PI id stays null until the link is actually paid.
        await tx
          .update(salePayment)
          .set({
            stripePaymentLinkId: paymentLink.paymentLinkId,
            updatedAt: new Date(),
          })
          .where(eq(salePayment.id, inserted.id));
        return loadSaleWithRelations(tx, organizationId, saleId);
      },
      { db }
    );

    return ok({
      ...(updated as SaleWithRelations),
      paymentLinkUrl: paymentLink.paymentLinkUrl,
    });
  } catch (error) {
    logError('sales.addSalePayment', error, {
      feature: 'sales',
      extra: { organizationId, saleId, method, amountCents },
    });
    return err(
      new FeatureError(ErrorCodes.INTERNAL_ERROR, 'Failed to add sale payment')
    );
  }
};

export const addSalePayment = (db: DbConnection, input: AddSalePaymentInput) =>
  trackedResult('sales.addSalePayment', () => addSalePaymentImpl(db, input), {
    properties: {
      organizationId: input.organizationId,
      saleId: input.saleId,
      method: input.method,
      amountCents: input.amountCents,
    },
  });

export type AddSalePaymentServiceResult = Awaited<
  ReturnType<typeof addSalePayment>
>;
