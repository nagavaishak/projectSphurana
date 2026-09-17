import {
  organization,
  subscriptions,
  withOrgScope,
} from '@borradh-workspace/database';
import { getStripeService } from '@borradh-workspace/integrations/stripe';
import { logError, trackedResult } from '@borradh-workspace/observability';
import { and, eq } from 'drizzle-orm';
import {
  type DbConnection,
  ErrorCodes,
  FeatureError,
  type Result,
  err,
  notDeleted,
  ok,
} from '../../../shared/index.js';
import { getOrgCountry } from '../../../shared/org-context.js';
import { BillingErrorCodes } from '../../models/billing-error.types.js';
import { billingCurrencyForCountry } from '../resolve-billing-currency/resolve-billing-currency.service.js';
import {
  type CreateSubscriptionCheckoutInput,
  createSubscriptionCheckoutSchema,
} from './create-subscription-checkout.schema.js';

export interface CheckoutResult {
  sessionId: string;
  url: string;
}

/**
 * Internal implementation
 */
const createSubscriptionCheckoutImpl = async (
  db: DbConnection,
  input: CreateSubscriptionCheckoutInput
): Promise<Result<CheckoutResult>> => {
  const parsed = createSubscriptionCheckoutSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  const {
    organizationId,
    customerEmail,
    successUrl,
    cancelUrl,
    trialDays,
    currency,
  } = parsed.data;

  try {
    // Check if organization exists
    const org = await withOrgScope(
      (tx) =>
        tx.query.organization.findFirst({
          where: and(
            eq(organization.id, organizationId),
            notDeleted(organization)
          ),
        }),
      { db }
    );

    if (!org) {
      return err(
        new FeatureError(ErrorCodes.NOT_FOUND, 'Organization not found')
      );
    }

    // Check if subscription already exists
    const existingSubscription = await withOrgScope(
      (tx) =>
        tx.query.subscriptions.findFirst({
          where: eq(subscriptions.organizationId, organizationId),
        }),
      { db }
    );

    if (existingSubscription?.status === 'active') {
      return err(
        new FeatureError(
          BillingErrorCodes.SUBSCRIPTION_ALREADY_EXISTS,
          'Organization already has an active subscription'
        )
      );
    }

    // Create checkout session via Stripe
    const stripe = getStripeService();

    // Use the org's pre-created Stripe customer, falling back to subscription record
    const existingCustomerId =
      org.stripeCustomerId ??
      existingSubscription?.stripeCustomerId ??
      undefined;

    // Resolve the billing currency authoritatively, in priority order:
    //   1. The currency the Stripe customer is already locked to (from a prior
    //      invoice). Stripe rejects a checkout in any other currency, so a lock
    //      ALWAYS wins - never override an existing customer's currency with the
    //      country. This is the safety net for existing orgs re-subscribing.
    //   2. The org's location country (an IE clinic in EUR, a GB one in GBP), so
    //      we don't inherit the client's browser-locale guess, which shows GBP
    //      for Irish orgs on en-GB devices.
    //   3. The client-sent currency, as a last resort when we know neither.
    // The Stripe service applies the same lock override defensively, but we
    // resolve it here too so correctness doesn't depend on the integration layer.
    const lockedCurrency = existingCustomerId
      ? await stripe.getCustomerCurrency(existingCustomerId)
      : null;
    const country = lockedCurrency
      ? null
      : await getOrgCountry(db, organizationId);
    const resolvedCurrency =
      lockedCurrency ?? billingCurrencyForCountry(country) ?? currency;

    const result = await stripe.createSubscriptionCheckout({
      organizationId,
      organizationName: org.name,
      customerEmail,
      successUrl,
      cancelUrl,
      customerId: existingCustomerId,
      trialDays,
      currency: resolvedCurrency,
    });

    return ok({
      sessionId: result.sessionId,
      url: result.url,
    });
  } catch (error) {
    logError('billing.createSubscriptionCheckout', error, {
      feature: 'billing',
      extra: { organizationId },
    });
    return err(
      new FeatureError(
        BillingErrorCodes.STRIPE_CHECKOUT_ERROR,
        'Failed to create checkout session'
      )
    );
  }
};

/**
 * Create a Stripe checkout session for subscription
 */
export const createSubscriptionCheckout = (
  db: DbConnection,
  input: CreateSubscriptionCheckoutInput
) =>
  trackedResult(
    'billing.createSubscriptionCheckout',
    () => createSubscriptionCheckoutImpl(db, input),
    { properties: { organizationId: input.organizationId } }
  );

export type CreateSubscriptionCheckoutResult = Awaited<
  ReturnType<typeof createSubscriptionCheckout>
>;
