import {
  type StripeConnectIntegration,
  stripeConnectIntegration,
  withOrgScope,
} from '@borradh-workspace/database';
import { getStripeConnectService } from '@borradh-workspace/integrations/stripe';
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
import {
  type RefreshStripeAccountInput,
  refreshStripeAccountSchema,
} from './refresh-stripe-account.schema.js';

/**
 * Refresh Stripe Connect account status from Stripe
 */
const refreshStripeAccountImpl = async (
  db: DbConnection,
  input: RefreshStripeAccountInput
): Promise<Result<StripeConnectIntegration>> => {
  const parsed = refreshStripeAccountSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  const { organizationId } = parsed.data;

  // Find existing integration
  const existing = await withOrgScope(
    (tx) =>
      tx.query.stripeConnectIntegration.findFirst({
        where: (t, { eq: eqOp }) => eqOp(t.organizationId, organizationId),
      }),
    { db }
  );

  if (!existing) {
    return err(
      new FeatureError(
        ErrorCodes.NOT_FOUND,
        'No Stripe integration found for this organization'
      )
    );
  }

  try {
    const stripeConnect = getStripeConnectService();

    // Fetch latest account info from Stripe
    const account = await stripeConnect.getAccountInfo(
      existing.stripeAccountId
    );

    // Update database with fresh info
    const [updated] = await withOrgScope(
      (tx) =>
        tx
          .update(stripeConnectIntegration)
          .set({
            accountName: account.businessName,
            accountEmail: account.email,
            chargesEnabled: account.chargesEnabled,
            payoutsEnabled: account.payoutsEnabled,
            detailsSubmitted: account.detailsSubmitted,
            defaultCurrency: account.defaultCurrency,
            requirementsCurrentlyDue: account.requirementsCurrentlyDue,
            disabledReason: account.disabledReason,
            lastSyncAt: new Date(),
            updatedAt: new Date(),
          })
          .where(eq(stripeConnectIntegration.organizationId, organizationId))
          .returning(),
      { db }
    );

    return ok(updated);
  } catch (error) {
    logError('integrations.refreshStripeAccount', error, {
      feature: 'integrations',
      extra: { organizationId, accountId: existing.stripeAccountId },
    });

    return err(
      new FeatureError(
        ErrorCodes.EXTERNAL_SERVICE_ERROR,
        'Failed to refresh Stripe account status'
      )
    );
  }
};

/**
 * Refresh Stripe Connect account status from Stripe
 */
export const refreshStripeAccount = (
  db: DbConnection,
  input: RefreshStripeAccountInput
) =>
  trackedResult(
    'integrations.refreshStripeAccount',
    () => refreshStripeAccountImpl(db, input),
    { properties: { organizationId: input.organizationId } }
  );

export type RefreshStripeAccountResult = Awaited<
  ReturnType<typeof refreshStripeAccount>
>;
