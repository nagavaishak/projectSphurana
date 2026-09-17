import {
  type SalePayment,
  salePayment,
  withOrgScope,
} from '@borradh-workspace/database';
import { getStripeConnectService } from '@borradh-workspace/integrations/stripe';
import { logError } from '@borradh-workspace/observability';
import { and, eq } from 'drizzle-orm';
import type { DbConnection } from '../../shared/index.js';

/** Stripe-backed tender methods that hold a cancelable Stripe object. */
const STRIPE_METHODS: SalePayment['method'][] = [
  'card_terminal',
  'manual_card',
  'qr_self_checkout',
];

/**
 * A pending Stripe tender is cancelable when it carries a Stripe handle we can
 * close: a PaymentIntent (terminal / manual card, and a QR once it's paid) or a
 * Payment Link (QR self-checkout, set at creation so an unscanned link can be
 * deactivated).
 */
const isCancelableStripeTender = (p: SalePayment): boolean =>
  STRIPE_METHODS.includes(p.method) &&
  (p.stripePaymentIntentId != null || p.stripePaymentLinkId != null);

/**
 * Close the Stripe side of the given tender rows (best-effort). Cancels the
 * PaymentIntent when present, otherwise deactivates the Payment Link so an
 * unscanned QR can no longer be paid. Runs OUTSIDE any DB transaction (never
 * hold a pooled connection across Stripe I/O). A failure (e.g. the PI already
 * succeeded, or the link was already used) is logged and swallowed so it never
 * blocks the caller.
 */
export const cancelStripeSideOfTenders = async (
  db: DbConnection,
  organizationId: string,
  saleId: string,
  tenders: SalePayment[]
): Promise<void> => {
  const stripeTenders = tenders.filter(isCancelableStripeTender);
  if (stripeTenders.length === 0) return;

  const integration = await withOrgScope(
    (tx) =>
      tx.query.stripeConnectIntegration.findFirst({
        where: (t, { eq: eqOp }) => eqOp(t.organizationId, organizationId),
      }),
    { db }
  );
  if (!integration) return;

  const stripeConnect = getStripeConnectService();
  for (const tender of stripeTenders) {
    try {
      if (tender.stripePaymentIntentId) {
        await stripeConnect.cancelPaymentIntent(
          integration.stripeAccountId,
          tender.stripePaymentIntentId
        );
      } else if (tender.stripePaymentLinkId) {
        // Expire any already-open checkout session FIRST (a scanned-but-unpaid
        // link stays payable ~24h otherwise), then deactivate the link so no new
        // scan can start one. Expiry is its own try so a list failure still lets
        // the link deactivate.
        try {
          await stripeConnect.expireOpenPaymentLinkSessions(
            integration.stripeAccountId,
            tender.stripePaymentLinkId
          );
        } catch (error) {
          logError('sales.cancelStripeSideOfTenders.expireSessions', error, {
            feature: 'sales',
            extra: {
              organizationId,
              saleId,
              salePaymentId: tender.id,
            },
          });
        }
        await stripeConnect.deactivatePaymentLink(
          integration.stripeAccountId,
          tender.stripePaymentLinkId
        );
      }
    } catch (error) {
      logError('sales.cancelStripeSideOfTenders', error, {
        feature: 'sales',
        extra: {
          organizationId,
          saleId,
          salePaymentId: tender.id,
          method: tender.method,
        },
      });
    }
  }
};

/**
 * Cancel the Stripe side of any still-`pending` Stripe tender on a sale BEFORE
 * the sale is completed/voided (which marks those rows `failed`). Without this,
 * a later real capture — a terminal PI collected after the fact, or a QR link
 * scanned late — would be discarded by the webhook (it only settles `pending`
 * rows) yet the money would already be captured on Stripe → lost money.
 *
 * Stripe-side only: the caller flips the rows to `failed` inside its own
 * transaction. Best-effort; see {@link cancelStripeSideOfTenders}.
 */
export const cancelPendingStripeTenders = async (
  db: DbConnection,
  organizationId: string,
  saleId: string
): Promise<void> => {
  const pending = await withOrgScope(
    (tx) =>
      tx.query.salePayment.findMany({
        where: and(
          eq(salePayment.saleId, saleId),
          eq(salePayment.status, 'pending')
        ),
      }),
    { db }
  );
  await cancelStripeSideOfTenders(db, organizationId, saleId, pending);
};
