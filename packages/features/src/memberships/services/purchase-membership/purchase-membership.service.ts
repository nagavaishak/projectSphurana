import {
  leadMembership,
  membershipPlan,
  withOrgScope,
} from '@borradh-workspace/database';
import { getStripeConnectService } from '@borradh-workspace/integrations/stripe';
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
import type { LeadMembership } from '../../models/index.js';
import {
  validForToDate,
  validForToStripeInterval,
} from '../../shared/valid-for.js';
import {
  type PurchaseMembershipInput,
  purchaseMembershipSchema,
} from './purchase-membership.schema.js';

/**
 * Purchase / assign a membership plan to a lead.
 *
 * - one_time plans: `validUntil` is computed from the plan's `validFor`,
 *   sessions come from `sessionCount` (NULL = unlimited). No Stripe involved.
 * - recurring plans: the plan's Stripe Product/Price on the org's connected
 *   account are created lazily (persisted back onto the plan), then a
 *   subscription is created for a connected-account customer built from the
 *   lead. `stripeSubscriptionId` is stored and `validUntil` mirrors the
 *   subscription's `current_period_end` (kept fresh by lifecycle webhooks).
 */
const purchaseMembershipImpl = async (
  db: DbConnection,
  input: PurchaseMembershipInput
): Promise<Result<LeadMembership>> => {
  const parsed = purchaseMembershipSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  const { organizationId, leadId, planId, saleItemId } = parsed.data;

  try {
    // Reads run in a short scope; all Stripe I/O happens OUTSIDE any
    // transaction (never hold a pooled connection across external I/O — see
    // add-sale-payment). Writes are persisted in short scopes at the end.
    const plan = await withOrgScope(
      (tx) =>
        tx.query.membershipPlan.findFirst({
          where: (t, { and: andOp, eq: eqOp }) =>
            andOp(eqOp(t.id, planId), eqOp(t.organizationId, organizationId)),
        }),
      { db }
    );

    if (!plan) {
      return err(
        new FeatureError(ErrorCodes.NOT_FOUND, 'Membership plan not found')
      );
    }

    if (!plan.isActive) {
      return err(
        new FeatureError(
          ErrorCodes.INVALID_STATE,
          'Membership plan is not active'
        )
      );
    }

    const existingLead = await withOrgScope(
      (tx) =>
        tx.query.lead.findFirst({
          where: (t, { and: andOp, eq: eqOp }) =>
            andOp(eqOp(t.id, leadId), eqOp(t.organizationId, organizationId)),
        }),
      { db }
    );

    if (!existingLead) {
      return err(new FeatureError(ErrorCodes.NOT_FOUND, 'Client not found'));
    }

    let stripeSubscriptionId: string | null = null;
    let validUntil: Date | null = null;

    if (plan.pricingType === 'recurring') {
      // Recurring memberships are Stripe subscriptions on the org's
      // connected account (contract §6.5).
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
            'Stripe Connect not configured. Please connect your Stripe account first.'
          )
        );
      }

      if (!integration.chargesEnabled) {
        return err(
          new FeatureError(
            ErrorCodes.INVALID_STATE,
            'Stripe account cannot accept payments. Please complete your Stripe account setup.'
          )
        );
      }

      const stripeConnect = getStripeConnectService();

      // Lazily create the Stripe product/price for this plan (external I/O,
      // outside any transaction).
      let priceId = plan.stripePriceId;
      if (!priceId) {
        const interval = validForToStripeInterval(plan.validFor);
        const priceResult = await stripeConnect.createRecurringPrice({
          connectedAccountId: integration.stripeAccountId,
          productName: plan.name,
          existingProductId: plan.stripeProductId ?? undefined,
          amountCents: plan.priceCents,
          currency: plan.currency,
          interval: interval.interval,
          intervalCount: interval.intervalCount,
          metadata: { membershipPlanId: plan.id, organizationId },
        });

        // Persist the newly-created Stripe ids on the plan (short write).
        await withOrgScope(
          (tx) =>
            tx
              .update(membershipPlan)
              .set({
                stripeProductId: priceResult.productId,
                stripePriceId: priceResult.priceId,
                updatedAt: new Date(),
              })
              .where(
                and(
                  eq(membershipPlan.id, plan.id),
                  eq(membershipPlan.organizationId, organizationId)
                )
              ),
          { db }
        );

        priceId = priceResult.priceId;
      }

      const { customerId } = await stripeConnect.createConnectedCustomer({
        connectedAccountId: integration.stripeAccountId,
        email: existingLead.email ?? undefined,
        name:
          [existingLead.firstName, existingLead.lastName]
            .filter(Boolean)
            .join(' ') || undefined,
        metadata: { leadId, organizationId },
      });

      // Period 1 is already collected by the in-store sale line, so anchor the
      // subscription's first bill at period-1-end (Stripe `trial_end`) to avoid
      // double-billing it.
      const firstPeriodEnd = validForToDate(new Date(), plan.validFor);

      const subscription = await stripeConnect.createConnectedSubscription({
        connectedAccountId: integration.stripeAccountId,
        customerId,
        priceId,
        trialEnd: firstPeriodEnd,
        // Deterministic key off lead + plan so a retried purchase can't open a
        // second subscription for the same membership.
        idempotencyKey: `membership-sub:${leadId}:${plan.id}`,
        metadata: { leadId, membershipPlanId: plan.id, organizationId },
      });

      stripeSubscriptionId = subscription.subscriptionId;
      validUntil = subscription.currentPeriodEnd;
    } else {
      validUntil = validForToDate(new Date(), plan.validFor);
    }

    // Persist the membership row (short write, after all Stripe I/O).
    const [membership] = await withOrgScope(
      (tx) =>
        tx
          .insert(leadMembership)
          .values({
            organizationId,
            leadId,
            planId: plan.id,
            sessionsRemaining: plan.sessionCount ?? null,
            validUntil,
            stripeSubscriptionId,
            status: 'active',
            saleItemId: saleItemId ?? null,
          })
          .returning(),
      { db }
    );

    return ok(membership);
  } catch (error) {
    logError('memberships.purchaseMembership', error, {
      feature: 'memberships',
      extra: { organizationId, leadId, planId },
    });
    return err(
      new FeatureError(
        ErrorCodes.INTERNAL_ERROR,
        'Failed to purchase membership'
      )
    );
  }
};

export const purchaseMembership = (
  db: DbConnection,
  input: PurchaseMembershipInput
) =>
  trackedResult(
    'memberships.purchaseMembership',
    // No outer transaction: the impl runs its reads/writes in short scopes and
    // performs Stripe I/O between them, so a pooled connection is never held
    // across external calls (prod pool-wedge risk).
    () => purchaseMembershipImpl(db, input),
    {
      properties: {
        organizationId: input.organizationId,
        leadId: input.leadId,
        planId: input.planId,
      },
    }
  );

export type PurchaseMembershipResult = Awaited<
  ReturnType<typeof purchaseMembership>
>;
