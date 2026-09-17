import {
  stripeConnectIntegration,
  withOrgScope,
} from '@borradh-workspace/database';
import {
  describeStripeError,
  getStripeConnectService,
  isTerminalDeauthorizeRefusal,
} from '@borradh-workspace/integrations/stripe';
import {
  createLogger,
  logError,
  trackedResult,
} from '@borradh-workspace/observability';
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
  type DisconnectStripeInput,
  disconnectStripeSchema,
} from './disconnect-stripe.schema.js';

const logger = createLogger('integrations');

/**
 * Disconnect Stripe Connect integration
 */
const disconnectStripeImpl = async (
  db: DbConnection,
  input: DisconnectStripeInput
): Promise<Result<{ success: true }>> => {
  const parsed = disconnectStripeSchema.safeParse(input);
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

  // Release the ownership stamp on the Stripe account (see
  // `BORRADH_ORG_METADATA_KEY`) before anything else. It has to come first
  // because revoking a Standard account's grant below also revokes our ability
  // to write to it — and a stamp left behind on a disconnected account would
  // refuse the merchant's next workspace with nothing to point at.
  //
  // Best-effort: disconnecting is what the user asked for and must not fail on
  // a metadata write. The cost of missing it is a later link refused with a
  // message naming the problem, which a human can resolve — not a silent
  // sharing of one payout destination.
  try {
    const stripeConnect = getStripeConnectService();
    await stripeConnect.releaseAccount(existing.stripeAccountId);
  } catch (error) {
    logger.warn(
      `Could not clear the Borradh ownership stamp on ${existing.stripeAccountId}; linking it to another workspace will need support`,
      {
        operation: 'integrations.disconnectStripe.releaseAccount',
        organizationId,
        accountId: existing.stripeAccountId,
        ...describeStripeError(error),
      }
    );
  }

  // Only Standard accounts have an OAuth grant to revoke — whether the owner
  // granted it in-product ('standard_oauth') or by completing the self-serve
  // link an operator later attached ('standard_linked'). Controller accounts
  // (embedded onboarding) are platform-owned, and Stripe rejects them with
  // "V2 Accounts cannot be disconnected via this endpoint" — a call that can
  // never succeed, so we skip it rather than fail it.
  if (
    existing.accountType === 'standard_oauth' ||
    existing.accountType === 'standard_linked'
  ) {
    try {
      const stripeConnect = getStripeConnectService();
      await stripeConnect.disconnectAccount(existing.stripeAccountId);
    } catch (error) {
      const context = {
        organizationId,
        accountId: existing.stripeAccountId,
        ...describeStripeError(error),
      };

      if (isTerminalDeauthorizeRefusal(error)) {
        // Stripe said no and will keep saying no — most often because the
        // platform still owes a negative balance on the account. Disconnecting
        // locally is what the user asked for and is all we promise in the UI,
        // so this is a warning to keep queryable, not an exception to page on.
        logger.warn(
          `Stripe refused to revoke access for ${existing.stripeAccountId}; disconnecting locally anyway`,
          {
            operation: 'integrations.disconnectStripe.revokeAccess',
            ...context,
          }
        );
      } else {
        // Stripe unavailable rather than refusing — worth reporting.
        logError('integrations.disconnectStripe.revokeAccess', error, {
          feature: 'integrations',
          extra: context,
        });
      }
    }
  }

  // Delete from database
  await withOrgScope(
    (tx) =>
      tx
        .delete(stripeConnectIntegration)
        .where(eq(stripeConnectIntegration.organizationId, organizationId)),
    { db }
  );

  return ok({ success: true });
};

/**
 * Disconnect Stripe Connect integration
 */
export const disconnectStripe = (
  db: DbConnection,
  input: DisconnectStripeInput
) =>
  trackedResult(
    'integrations.disconnectStripe',
    () => disconnectStripeImpl(db, input),
    { properties: { organizationId: input.organizationId } }
  );

export type DisconnectStripeResult = Awaited<
  ReturnType<typeof disconnectStripe>
>;
