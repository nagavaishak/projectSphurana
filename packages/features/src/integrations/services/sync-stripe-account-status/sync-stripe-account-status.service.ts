import {
  type StripeConnectIntegration,
  stripeConnectIntegration,
} from '@borradh-workspace/database';
import { createLogger, trackedResult } from '@borradh-workspace/observability';
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
  type SyncStripeAccountStatusInput,
  syncStripeAccountStatusSchema,
} from './sync-stripe-account-status.schema.js';

const logger = createLogger('SyncStripeAccountStatus');

/**
 * Sync Stripe Connect account status from webhook event
 *
 * Called when receiving account.updated webhook from Stripe Connect.
 * Updates the local database with the latest account status.
 */
const syncStripeAccountStatusImpl = async (
  db: DbConnection,
  input: SyncStripeAccountStatusInput
): Promise<Result<StripeConnectIntegration | null>> => {
  const parsed = syncStripeAccountStatusSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  const {
    stripeAccountId,
    chargesEnabled,
    payoutsEnabled,
    detailsSubmitted,
    email,
    businessName,
    defaultCurrency,
    requirementsCurrentlyDue,
    disabledReason,
  } = parsed.data;

  // Find existing integration by Stripe account ID
  const existing = await db.query.stripeConnectIntegration.findFirst({
    where: (t, { eq: eqOp }) => eqOp(t.stripeAccountId, stripeAccountId),
  });

  if (!existing) {
    // Not an error - we might receive webhooks for accounts we don't track
    logger.debug('No integration found for Stripe account', {
      stripeAccountId,
    });
    return ok(null);
  }

  // Update database with webhook data
  const [updated] = await db
    .update(stripeConnectIntegration)
    .set({
      chargesEnabled,
      payoutsEnabled,
      detailsSubmitted,
      ...(email !== undefined && { accountEmail: email }),
      ...(businessName !== undefined && { accountName: businessName }),
      ...(defaultCurrency !== undefined && { defaultCurrency }),
      ...(requirementsCurrentlyDue !== undefined && {
        requirementsCurrentlyDue,
      }),
      ...(disabledReason !== undefined && { disabledReason }),
      lastSyncAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(stripeConnectIntegration.stripeAccountId, stripeAccountId))
    .returning();

  logger.info('Stripe account status synced', {
    stripeAccountId,
    organizationId: existing.organizationId,
    chargesEnabled,
    payoutsEnabled,
    detailsSubmitted,
  });

  return ok(updated);
};

/**
 * Sync Stripe Connect account status from webhook event
 *
 * @param db - Database connection
 * @param input - Account status data from webhook
 * @returns Updated integration or null if not found
 *
 * @example
 * ```ts
 * const result = await syncStripeAccountStatus(db, {
 *   stripeAccountId: 'acct_xxx',
 *   chargesEnabled: true,
 *   payoutsEnabled: true,
 *   detailsSubmitted: true,
 * });
 *
 * if (result.success && result.data) {
 *   console.log('Account synced:', result.data.organizationId);
 * }
 * ```
 */
export const syncStripeAccountStatus = (
  db: DbConnection,
  input: SyncStripeAccountStatusInput
) =>
  trackedResult(
    'integrations.syncStripeAccountStatus',
    () => syncStripeAccountStatusImpl(db, input),
    { properties: { stripeAccountId: input.stripeAccountId } }
  );

export type SyncStripeAccountStatusResult = Awaited<
  ReturnType<typeof syncStripeAccountStatus>
>;
