import { apiEnv } from '@borradh-workspace/env/api';
import { getStripeConnectService } from '@borradh-workspace/integrations/stripe';
import { trackedResult } from '@borradh-workspace/observability';
import {
  ErrorCodes,
  FeatureError,
  type Result,
  err,
  ok,
} from '../../../shared/index.js';

export interface SelfServeStripeLink {
  /** The link to send a merchant. Reusable — the same URL for everyone. */
  url: string;
  /**
   * The redirect URI baked into it. Surfaced because Stripe rejects the flow
   * unless this exact string is registered in the platform's OAuth settings,
   * and that is the one setup step nothing in the product can do for you.
   */
  redirectUri: string;
}

const SELF_SERVE_CALLBACK_PATH = '/integrations/stripe/self-serve/callback';

/**
 * The shareable Stripe onboarding link, built from platform configuration.
 *
 * It is a constant per environment, not per organization — which is the point:
 * it can go in an email template, and the merchant who follows it does not
 * need a Borradh account, or even to exist in our database yet.
 */
const getSelfServeStripeLinkImpl = (): Result<SelfServeStripeLink> => {
  const apiUrl = apiEnv.API_URL?.replace(/\/+$/, '');
  if (!apiUrl) {
    return err(
      new FeatureError(
        ErrorCodes.INVALID_STATE,
        'API_URL is not configured, so the callback URL for the onboarding link cannot be built.'
      )
    );
  }

  const redirectUri = `${apiUrl}${SELF_SERVE_CALLBACK_PATH}`;

  try {
    const url = getStripeConnectService().selfServeOnboardingUrl(redirectUri);
    return ok({ url, redirectUri });
  } catch {
    // The service constructor throws when STRIPE_CONNECT_CLIENT_ID is unset.
    return err(
      new FeatureError(
        ErrorCodes.INVALID_STATE,
        'STRIPE_CONNECT_CLIENT_ID is not configured, so no onboarding link can be built.'
      )
    );
  }
};

/** The shareable Stripe onboarding link for this environment. */
export const getSelfServeStripeLink = () =>
  trackedResult(
    'integrations.getSelfServeStripeLink',
    async () => getSelfServeStripeLinkImpl(),
    { trackSuccess: false }
  );

export type GetSelfServeStripeLinkResult = Awaited<
  ReturnType<typeof getSelfServeStripeLink>
>;
