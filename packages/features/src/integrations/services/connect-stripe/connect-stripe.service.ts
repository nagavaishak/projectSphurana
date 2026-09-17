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
  type ConnectStripeInput,
  connectStripeSchema,
} from './connect-stripe.schema.js';

/**
 * Complete Stripe Connect OAuth flow
 */
const connectStripeImpl = async (
  db: DbConnection,
  input: ConnectStripeInput
): Promise<Result<StripeConnectIntegration>> => {
  const parsed = connectStripeSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  const { organizationId, userId, code } = parsed.data;

  // State authenticity is established at the ENTRY POINT by OAuthStateGuard,
  // which verifies the HMAC before this service is ever reached.
  //
  // A check used to live here and it was a TAUTOLOGY — the most dangerous kind
  // of dead control, because it reads as protection:
  //
  //     const statePayload = JSON.parse(Buffer.from(state,'base64').toString());
  //     if (statePayload.organizationId !== organizationId) return err(...);
  //
  // `organizationId` was itself decoded from that same `state` blob by the
  // controller one layer up, so this compared the caller's value against
  // itself and could not fail for any input, forged or not. Deleting it
  // removes nothing real; the signature check that replaced it is the first
  // thing here that ever actually constrained the caller.

  try {
    const stripeConnect = getStripeConnectService();

    // Exchange code for account access
    const { accountId, account } =
      await stripeConnect.handleOAuthCallback(code);

    // Check if already connected - if so, update
    const existing = await withOrgScope(
      (tx) =>
        tx.query.stripeConnectIntegration.findFirst({
          where: (t, { eq: eqOp }) => eqOp(t.organizationId, organizationId),
        }),
      { db }
    );

    let integration: StripeConnectIntegration;

    if (existing) {
      // Update existing integration
      [integration] = await withOrgScope(
        (tx) =>
          tx
            .update(stripeConnectIntegration)
            .set({
              connectedById: userId,
              stripeAccountId: accountId,
              accountName: account.businessName,
              accountEmail: account.email,
              chargesEnabled: account.chargesEnabled,
              payoutsEnabled: account.payoutsEnabled,
              detailsSubmitted: account.detailsSubmitted,
              defaultCurrency: account.defaultCurrency,
              isActive: true,
              lastSyncAt: new Date(),
              updatedAt: new Date(),
            })
            .where(eq(stripeConnectIntegration.organizationId, organizationId))
            .returning(),
        { db }
      );
    } else {
      // Insert new integration
      [integration] = await withOrgScope(
        (tx) =>
          tx
            .insert(stripeConnectIntegration)
            .values({
              organizationId,
              connectedById: userId,
              stripeAccountId: accountId,
              accountName: account.businessName,
              accountEmail: account.email,
              chargesEnabled: account.chargesEnabled,
              payoutsEnabled: account.payoutsEnabled,
              detailsSubmitted: account.detailsSubmitted,
              defaultCurrency: account.defaultCurrency,
              isActive: true,
              lastSyncAt: new Date(),
            })
            .returning(),
        { db }
      );
    }

    return ok(integration);
  } catch (error) {
    logError('integrations.connectStripe', error, {
      feature: 'integrations',
      extra: { organizationId },
    });

    if (error instanceof Error) {
      if (error.message.includes('No Stripe account')) {
        return err(
          new FeatureError(
            ErrorCodes.EXTERNAL_SERVICE_ERROR,
            'Failed to connect Stripe account. Please try again.'
          )
        );
      }
      if (error.message.includes('CLIENT_ID')) {
        return err(
          new FeatureError(
            ErrorCodes.EXTERNAL_SERVICE_ERROR,
            'Stripe Connect is not configured. Please contact support.'
          )
        );
      }
    }

    return err(
      new FeatureError(
        ErrorCodes.INTERNAL_ERROR,
        'An unexpected error occurred while connecting Stripe'
      )
    );
  }
};

/**
 * Complete Stripe Connect OAuth flow
 */
export const connectStripe = (db: DbConnection, input: ConnectStripeInput) =>
  trackedResult(
    'integrations.connectStripe',
    () => connectStripeImpl(db, input),
    {
      properties: { organizationId: input.organizationId },
    }
  );

export type ConnectStripeResult = Awaited<ReturnType<typeof connectStripe>>;
