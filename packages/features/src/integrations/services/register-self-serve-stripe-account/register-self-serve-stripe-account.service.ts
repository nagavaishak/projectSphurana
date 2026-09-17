import {
  describeStripeError,
  getStripeConnectService,
} from '@borradh-workspace/integrations/stripe';
import { createLogger, logError } from '@borradh-workspace/observability';
import {
  type OAuthRedirectResult,
  oauthRedirect,
} from '../../../shared/index.js';
import {
  type RegisterSelfServeStripeAccountInput,
  registerSelfServeStripeAccountSchema,
} from './register-self-serve-stripe-account.schema.js';

const logger = createLogger('integrations');

/**
 * Where the merchant lands afterwards. A public route — they have no account
 * yet, so it cannot sit behind the authed shell.
 */
const DONE_ROUTE = '/connect/stripe/done';

/**
 * Complete a Stripe Connect OAuth handshake that belongs to NO organization
 * yet.
 *
 * This is what makes a shareable onboarding link possible. Stripe's Account
 * Links cannot be it: they are single-use, expire in minutes, are scoped to an
 * account that must already exist, and Stripe's own guidance is not to send
 * them outside the platform application (a link preview in a messaging client
 * burns one before the merchant clicks). The Standard OAuth authorize URL is
 * the one link that is reusable, needs no prior account on either side, and can
 * sit in a follow-up email after a sales call.
 *
 * Exchanging the code is not bookkeeping — it is the step that actually
 * attaches the account to our platform. Without it the merchant finishes Stripe
 * signup and appears nowhere in our Connect accounts list, so there is nothing
 * for an operator to link and no way to tell it went wrong.
 *
 * Deliberately writes NOTHING locally. We do not know which organization this
 * is, and guessing (by email, by business name) is exactly the mistake that
 * points one merchant's payouts at another. The account waits in Stripe until
 * an operator attaches it by id — see `linkStripeAccount`, which does the
 * verification and the cross-org ownership check.
 *
 * The absence of a `state` parameter is safe here in a way it would not be on
 * the org-scoped callback: there is no session to confuse and no organization
 * to bind to, so the only outcome an attacker could force is connecting an
 * account they already control to our platform, which is what the endpoint
 * offers everyone anyway.
 */
const registerSelfServeStripeAccountImpl = async (
  input: RegisterSelfServeStripeAccountInput
): Promise<OAuthRedirectResult> => {
  const parsed = registerSelfServeStripeAccountSchema.safeParse(input);
  const code = parsed.success ? parsed.data.code : undefined;
  const declined = parsed.success ? parsed.data.error : undefined;

  // Pressing cancel on Stripe's consent screen is not a fault, and telling
  // someone "something went wrong" when they chose to stop is how a support
  // ticket gets raised about a system that worked.
  if (declined || !code) {
    return oauthRedirect(DONE_ROUTE, { status: 'cancelled' });
  }

  try {
    const stripeConnect = getStripeConnectService();
    const { accountId } = await stripeConnect.handleOAuthCallback(code);

    logger.info('Self-serve Stripe account connected', { accountId });

    // The account id rides on the URL so the landing page can show it and the
    // merchant can quote it to their onboarding contact. It is an identifier,
    // not a credential: it grants nothing on its own, and attaching it to a
    // workspace requires a platform admin.
    return oauthRedirect(DONE_ROUTE, {
      status: 'connected',
      account: accountId,
    });
  } catch (error) {
    logError('integrations.registerSelfServeStripeAccount', error, {
      feature: 'integrations',
      extra: { ...describeStripeError(error) },
    });
    return oauthRedirect(DONE_ROUTE, { status: 'error' });
  }
};

/**
 * Complete an org-less Stripe Connect OAuth handshake from a shareable link.
 */
export const registerSelfServeStripeAccount = (
  input: RegisterSelfServeStripeAccountInput
): Promise<OAuthRedirectResult> => registerSelfServeStripeAccountImpl(input);

export type RegisterSelfServeStripeAccountResult = Awaited<
  ReturnType<typeof registerSelfServeStripeAccount>
>;
