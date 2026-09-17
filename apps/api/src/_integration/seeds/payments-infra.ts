/**
 * Payments-infra seed helpers for the integration harness.
 *
 * Kept out of harness.ts (per the harness "do not edit" rule): this file only
 * inserts a real `stripe_connect_integration` row so the DB-only branches of
 * the Stripe Connect + Terminal controllers can be reached WITHOUT calling the
 * real Stripe API. Shared org/user/member seeding is re-used from ../harness.js
 * by the spec.
 *
 * `stripe_connect_integration` NOT-NULL columns with no DB default:
 * organizationId (also UNIQUE), stripeAccountId. `accountType` defaults to
 * 'standard_oauth'; `chargesEnabled` / `payoutsEnabled` / `detailsSubmitted`
 * default false; `isActive` defaults true; `id` defaults to a cuid2 — we pass
 * an explicit id so we can return it.
 */
import { randomUUID } from 'node:crypto';
import { db, stripeConnectIntegration } from '@borradh-workspace/database';

/**
 * Insert a real `stripe_connect_integration` row scoped to an org. Returns its
 * id.
 *
 * Only the fields the DB-read services (`getStripeConnectStatus` /
 * `getStripeConnection`) surface are parameterised. `isActive` defaults true so
 * the Terminal `requireConnectedAccount` gate treats the account as connected;
 * pass `isActive: false` to model a de-activated connection.
 */
export async function seedStripeConnectIntegration(input: {
  organizationId: string;
  stripeAccountId?: string;
  accountType?: 'standard_oauth' | 'controller';
  chargesEnabled?: boolean;
  payoutsEnabled?: boolean;
  detailsSubmitted?: boolean;
  requirementsCurrentlyDue?: string[];
  disabledReason?: string | null;
  isActive?: boolean;
}): Promise<string> {
  const id = `stripe_${randomUUID()}`;
  await db.insert(stripeConnectIntegration).values({
    id,
    organizationId: input.organizationId,
    stripeAccountId:
      input.stripeAccountId ?? `acct_${randomUUID().slice(0, 16)}`,
    accountType: input.accountType ?? 'controller',
    chargesEnabled: input.chargesEnabled ?? false,
    payoutsEnabled: input.payoutsEnabled ?? false,
    detailsSubmitted: input.detailsSubmitted ?? false,
    requirementsCurrentlyDue: input.requirementsCurrentlyDue ?? null,
    disabledReason: input.disabledReason ?? null,
    isActive: input.isActive ?? true,
  });
  return id;
}
