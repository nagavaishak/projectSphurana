import { buildOAuthProxyParams } from '@borradh-workspace/integrations/shared';
import { getStripeConnectService } from '@borradh-workspace/integrations/stripe';
import { logError, trackedResult } from '@borradh-workspace/observability';
import {
  type DbConnection,
  ErrorCodes,
  FeatureError,
  type Result,
  err,
  ok,
  signOAuthState,
} from '../../../shared/index.js';
import {
  type InitiateStripeConnectInput,
  initiateStripeConnectSchema,
} from './initiate-stripe-connect.schema.js';

export interface StripeOAuthSession {
  url: string;
  state: string;
}

/**
 * Initiate Stripe Connect OAuth - generates OAuth URL
 */
const initiateStripeConnectImpl = async (
  _db: DbConnection,
  input: InitiateStripeConnectInput
): Promise<Result<StripeOAuthSession>> => {
  const parsed = initiateStripeConnectSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  const { organizationId, userId, redirectUri, organizationEmail, returnTo } =
    parsed.data;

  try {
    const stripeConnect = getStripeConnectService();

    // HMAC-SIGNED state (Stripe passes it back unchanged). This was previously
    // plain base64 JSON carrying a `nonce: randomUUID()` that was generated,
    // never persisted, and therefore never checkable — so the callback trusted
    // whatever organizationId came back to it. For Stripe Connect specifically
    // that let an attacker point a victim organization's payouts at their own
    // connected account. See packages/features/src/shared/oauth-state.ts.
    const innerState = signOAuthState({
      organizationId,
      userId,
      provider: 'stripe',
      returnTo,
    });
    if (!innerState) {
      return err(
        new FeatureError(
          ErrorCodes.INTERNAL_ERROR,
          'OAuth state signing is not configured'
        )
      );
    }

    // When the OAuth proxy is configured, swap redirect_uri for the proxy
    // and wrap our CSRF state with the originating service's URL. The
    // `redirectUri` arg from the controller becomes the fallback when
    // proxy isn't set (local dev).
    const { redirectUri: actualRedirectUri, state: actualState } =
      buildOAuthProxyParams(
        'stripe-connect',
        {
          callbackPath: '/integrations/stripe/callback',
          inner: innerState,
        },
        redirectUri
      );

    const result = stripeConnect.generateOAuthLink(
      actualRedirectUri,
      actualState ?? innerState,
      organizationEmail
    );

    return ok({
      url: result.url,
      state: result.state,
    });
  } catch (error) {
    if (error instanceof Error && error.message.includes('CLIENT_ID')) {
      return err(
        new FeatureError(
          ErrorCodes.EXTERNAL_SERVICE_ERROR,
          'Stripe Connect is not configured. Please contact support.'
        )
      );
    }

    logError('integrations.initiateStripeConnect', error, {
      feature: 'integrations',
      extra: { organizationId },
    });
    return err(
      new FeatureError(
        ErrorCodes.INTERNAL_ERROR,
        'Failed to generate Stripe Connect link'
      )
    );
  }
};

/**
 * Initiate Stripe Connect OAuth flow
 */
export const initiateStripeConnect = (
  db: DbConnection,
  input: InitiateStripeConnectInput
) =>
  trackedResult(
    'integrations.initiateStripeConnect',
    () => initiateStripeConnectImpl(db, input),
    { properties: { organizationId: input.organizationId } }
  );

export type InitiateStripeConnectResult = Awaited<
  ReturnType<typeof initiateStripeConnect>
>;
