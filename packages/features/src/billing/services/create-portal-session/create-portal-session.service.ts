import { subscriptions, withOrgScope } from '@borradh-workspace/database';
import { getStripeService } from '@borradh-workspace/integrations/stripe';
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
  type CreatePortalSessionInput,
  createPortalSessionSchema,
} from './create-portal-session.schema.js';

export interface PortalResult {
  url: string;
}

/**
 * Internal implementation
 */
const createPortalSessionImpl = async (
  db: DbConnection,
  input: CreatePortalSessionInput
): Promise<Result<PortalResult>> => {
  const parsed = createPortalSessionSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  const { organizationId, returnUrl } = parsed.data;

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
          'No subscription found for this organization'
        )
      );
    }

    // Create portal session
    const stripe = getStripeService();
    const result = await stripe.createPortalSession(
      subscription.stripeCustomerId,
      returnUrl
    );

    return ok({
      url: result.url,
    });
  } catch (error) {
    logError('billing.createPortalSession', error, {
      feature: 'billing',
      extra: { organizationId },
    });
    return err(
      new FeatureError(
        ErrorCodes.INTERNAL_ERROR,
        'Failed to create billing portal session'
      )
    );
  }
};

/**
 * Create a Stripe customer portal session
 */
export const createPortalSession = (
  db: DbConnection,
  input: CreatePortalSessionInput
) =>
  trackedResult(
    'billing.createPortalSession',
    () => createPortalSessionImpl(db, input),
    { properties: { organizationId: input.organizationId } }
  );

export type CreatePortalSessionResult = Awaited<
  ReturnType<typeof createPortalSession>
>;
