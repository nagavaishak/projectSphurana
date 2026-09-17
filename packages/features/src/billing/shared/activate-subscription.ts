import {
  creditBalances,
  creditTransactions,
  organization,
  subscriptions,
} from '@borradh-workspace/database';
import { and, eq } from 'drizzle-orm';
import { type DbConnection, notDeleted } from '../../shared/index.js';
import { fireNotionSubscriptionActivated } from '../../shared/notion-crm.js';

/** Included credits granted on first activation, in precision units (1000 credits). */
const INCLUDED_CREDITS = 100000;

export interface ActivateSubscriptionInput {
  organizationId: string;
  stripeCustomerId: string;
  stripeSubscriptionId: string;
  /** Stripe's own status; defaults to active for the checkout path. */
  status?:
    | 'active'
    | 'trialing'
    | 'past_due'
    | 'canceled'
    | 'incomplete'
    | 'incomplete_expired'
    | 'unpaid'
    | 'paused';
  stripePriceId?: string | null;
  currentPeriodStart?: Date | null;
  currentPeriodEnd?: Date | null;
  cancelAtPeriodEnd?: boolean;
  canceledAt?: Date | null;
  planId?: string;
}

/**
 * Everything that has to be true for an organization to be a paying customer:
 * the subscription row, the customer id on the org, the opening credit
 * balance and its ledger entry, and the CRM ping.
 *
 * It is shared rather than duplicated because the two ways an org can arrive
 * here — completing Stripe Checkout in-product, or being seeded from a
 * subscription sold over the phone — must produce the SAME state. When this
 * lived only inside the checkout webhook, any second path would have had to
 * re-derive it, and the piece most easily forgotten is the credit balance:
 * the org would look subscribed everywhere, and then be unable to send a
 * single message, with nothing in the billing UI to explain why.
 *
 * Idempotent: the credit grant happens only when no balance row exists, so
 * re-running it (a webhook retry, a re-seed) never mints credits twice.
 */
export const activateSubscription = async (
  db: DbConnection,
  input: ActivateSubscriptionInput
): Promise<void> => {
  const {
    organizationId,
    stripeCustomerId,
    stripeSubscriptionId,
    status = 'active',
    stripePriceId,
    currentPeriodStart,
    currentPeriodEnd,
    cancelAtPeriodEnd,
    canceledAt,
    planId = 'pro',
  } = input;

  const existing = await db.query.subscriptions.findFirst({
    where: eq(subscriptions.organizationId, organizationId),
  });

  const values = {
    stripeCustomerId,
    stripeSubscriptionId,
    status,
    ...(stripePriceId !== undefined && { stripePriceId }),
    ...(currentPeriodStart !== undefined && { currentPeriodStart }),
    ...(currentPeriodEnd !== undefined && { currentPeriodEnd }),
    ...(cancelAtPeriodEnd !== undefined && { cancelAtPeriodEnd }),
    ...(canceledAt !== undefined && { canceledAt }),
  };

  if (existing) {
    await db
      .update(subscriptions)
      .set(values)
      .where(eq(subscriptions.organizationId, organizationId));
  } else {
    await db.insert(subscriptions).values({
      id: crypto.randomUUID(),
      organizationId,
      planId,
      ...values,
    });
  }

  // Sync the Stripe customer id onto the org (in case pre-creation was skipped).
  await db
    .update(organization)
    .set({ stripeCustomerId })
    .where(and(eq(organization.id, organizationId), notDeleted(organization)));

  const existingBalance = await db.query.creditBalances.findFirst({
    where: eq(creditBalances.organizationId, organizationId),
  });

  if (!existingBalance) {
    await db.insert(creditBalances).values({
      id: crypto.randomUUID(),
      organizationId,
      balance: INCLUDED_CREDITS,
      includedCredits: INCLUDED_CREDITS,
      lastRefillAt: new Date(),
    });

    await db.insert(creditTransactions).values({
      id: crypto.randomUUID(),
      organizationId,
      type: 'subscription_refill',
      amount: INCLUDED_CREDITS,
      balanceAfter: INCLUDED_CREDITS,
      description: 'Initial subscription credits',
    });
  }

  // Best-effort: a CRM update must never fail an activation.
  try {
    const org = await db.query.organization.findFirst({
      where: (o, { and: andOp, eq: eqOp, isNull }) =>
        andOp(eqOp(o.id, organizationId), isNull(o.deletedAt)),
      columns: { name: true },
    });
    const ownerMember = await db.query.member.findFirst({
      where: (m, { and: andOp, eq: eqOp }) =>
        andOp(eqOp(m.organizationId, organizationId), eqOp(m.role, 'owner')),
      with: { user: { columns: { email: true } } },
    });
    const ownerEmail = (ownerMember as { user?: { email?: string } })?.user
      ?.email;
    if (org?.name && ownerEmail) {
      fireNotionSubscriptionActivated(ownerEmail, org.name);
    }
  } catch {
    // Intentionally swallowed — see above.
  }
};
