import { subscriptions, withOrgScope } from '@borradh-workspace/database';
import {
  type CreditPackage,
  getStripeService,
} from '@borradh-workspace/integrations/stripe';
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
import { BillingErrorCodes } from '../../models/billing-error.types.js';
import {
  type CreateCreditsCheckoutInput,
  createCreditsCheckoutSchema,
} from './create-credits-checkout.schema.js';

export interface CreditsCheckoutResult {
  sessionId: string;
  url: string;
}

/**
 * Internal implementation
 */
const createCreditsCheckoutImpl = async (
  db: DbConnection,
  input: CreateCreditsCheckoutInput
): Promise<Result<CreditsCheckoutResult>> => {
  const parsed = createCreditsCheckoutSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  const { organizationId, creditPackageId, quantity, successUrl, cancelUrl } =
    parsed.data;

  try {
    // Get subscription to find customer ID
    const subscription = await withOrgScope(
      (tx) =>
        tx.query.subscriptions.findFirst({
          where: eq(subscriptions.organizationId, organizationId),
        }),
      { db }
    );

    if (!subscription?.stripeCustomerId) {
      return err(
        new FeatureError(
          BillingErrorCodes.SUBSCRIPTION_NOT_FOUND,
          'No subscription found. Please subscribe first.'
        )
      );
    }

    // Validate credit package exists
    const stripe = getStripeService();
    const packages = stripe.getCreditPackages();
    const creditPackage = packages.find(
      (p: CreditPackage) => p.id === creditPackageId
    );

    if (!creditPackage) {
      return err(
        new FeatureError(
          BillingErrorCodes.INVALID_CREDIT_PACKAGE,
          'Invalid credit package'
        )
      );
    }

    // Create checkout session
    const result = await stripe.createCreditsCheckout({
      organizationId,
      customerId: subscription.stripeCustomerId,
      creditPackageId,
      quantity,
      successUrl,
      cancelUrl,
    });

    return ok({
      sessionId: result.sessionId,
      url: result.url,
    });
  } catch (error) {
    logError('billing.createCreditsCheckout', error, {
      feature: 'billing',
      extra: { organizationId, creditPackageId },
    });
    return err(
      new FeatureError(
        BillingErrorCodes.STRIPE_CHECKOUT_ERROR,
        'Failed to create credits checkout session'
      )
    );
  }
};

/**
 * Create a Stripe checkout session for credit purchase
 */
export const createCreditsCheckout = (
  db: DbConnection,
  input: CreateCreditsCheckoutInput
) =>
  trackedResult(
    'billing.createCreditsCheckout',
    () => createCreditsCheckoutImpl(db, input),
    { properties: { organizationId: input.organizationId } }
  );

export type CreateCreditsCheckoutResult = Awaited<
  ReturnType<typeof createCreditsCheckout>
>;
