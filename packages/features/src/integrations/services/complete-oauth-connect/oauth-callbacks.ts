import { trackOrgEvent } from '@borradh-workspace/observability';
import {
  type DbConnection,
  type OAuthRedirectResult,
  type OAuthStatePayload,
  oauthRedirect,
} from '../../../shared/index.js';
import { connectCalendly } from '../connect-calendly/index.js';
import { connectGmail } from '../connect-gmail/index.js';
import { connectGoogleCalendar } from '../connect-google-calendar/index.js';
import { connectGoogleMyBusiness } from '../connect-google-my-business/index.js';
import { connectInstagram } from '../connect-instagram/index.js';
import { initiateMetaOAuth } from '../connect-meta-ads/index.js';
import { connectOutlook } from '../connect-outlook/index.js';
import { connectStripe } from '../connect-stripe/index.js';
import { connectTimely } from '../connect-timely/index.js';
import {
  INTEGRATIONS_PATH,
  completeOAuthConnect,
  statusRedirect,
} from './complete-oauth-connect.service.js';

/**
 * One wrapper per provider callback.
 *
 * Each holds exactly the thing that differs between providers — the connect
 * service and the redirect destinations — and delegates the identical part to
 * `completeOAuthConnect`. That is why the controller handlers can be one line
 * each with no `@Res()`.
 *
 * The redirect shapes here are transcribed from the pre-refactor handlers and
 * are deliberately NOT normalised. Several are inconsistent with each other
 * (Instagram's `?instagram=` param, Calendly/Timely's split between a fixed
 * error path and a `returnTo` success path). Making them uniform would be a
 * frontend-visible behaviour change, which is not what this change is for.
 */

export interface OAuthCallbackArgs {
  state: OAuthStatePayload;
  code: string | undefined;
  oauthError?: string;
  oauthErrorDescription?: string;
  /**
   * Google My Business alone carries two extra query params through its
   * callback. They are optional here so the other eight wrappers ignore them,
   * and they keep the pre-refactor `|| ''` coercion rather than becoming
   * required — that coercion is load-bearing: the provider omits both on the
   * first leg of the flow.
   */
  locationId?: string;
  accountName?: string;
}

// ---------------------------------------------------------------- email

export const completeGmailCallback = (db: DbConnection, a: OAuthCallbackArgs) =>
  completeOAuthConnect({
    ...a,
    operation: 'integrations.gmailOAuth',
    connect: ({ organizationId, code }) =>
      connectGmail(db, { organizationId, code }),
    onSuccess: () => statusRedirect(INTEGRATIONS_PATH, 'gmail', 'connected'),
    onFailure: (message) =>
      statusRedirect(INTEGRATIONS_PATH, 'gmail', 'error', message),
  });

export const completeOutlookCallback = (
  db: DbConnection,
  a: OAuthCallbackArgs
) =>
  completeOAuthConnect({
    ...a,
    operation: 'integrations.outlookOAuth',
    connect: ({ organizationId, code }) =>
      connectOutlook(db, { organizationId, code }),
    onSuccess: () => statusRedirect(INTEGRATIONS_PATH, 'outlook', 'connected'),
    onFailure: (message) =>
      statusRedirect(INTEGRATIONS_PATH, 'outlook', 'error', message),
  });

// ------------------------------------------------------------- calendar

export const completeGoogleCalendarCallback = (
  db: DbConnection,
  a: OAuthCallbackArgs
) =>
  completeOAuthConnect({
    ...a,
    operation: 'integrations.googleCalendarOAuth',
    requireUserId: true,
    connect: ({ organizationId, userId, code }) =>
      connectGoogleCalendar(db, { organizationId, userId, code }),
    // Both outcomes honour returnTo — this callback is reached from onboarding.
    onSuccess: (_d, returnPath) =>
      statusRedirect(returnPath, 'calendar', 'connected'),
    onFailure: (message, returnPath) =>
      statusRedirect(returnPath, 'calendar', 'error', message),
  });

// ------------------------------------------------------------- meta ads

export const completeMetaAdsCallback = (
  db: DbConnection,
  a: OAuthCallbackArgs
) =>
  completeOAuthConnect({
    ...a,
    operation: 'integrations.metaAdsOAuth',
    requireUserId: true,
    connect: ({ organizationId, userId, code }) =>
      initiateMetaOAuth(db, { organizationId, userId, code }),
    // Success drops the user into the selection wizard, not back to settings.
    onSuccess: () => oauthRedirect('/connect/meta-ads'),
    onFailure: (message) =>
      statusRedirect(INTEGRATIONS_PATH, 'meta-ads', 'error', message),
    onOutcome: (o) =>
      trackOrgEvent(
        o.organizationId,
        'integrations.meta_ads_connect.callback',
        {
          status: o.status === 'success' ? 'success' : o.status,
          errorCode: o.errorCode ?? null,
          error: o.error ?? null,
          errorDescription: o.errorDescription ?? null,
        }
      ),
  });

// ------------------------------------------------------------ instagram

export const completeInstagramCallback = (
  db: DbConnection,
  a: OAuthCallbackArgs
) =>
  completeOAuthConnect({
    ...a,
    operation: 'integrations.instagramOAuth',
    requireUserId: true,
    connect: ({ organizationId, userId, code }) =>
      connectInstagram(db, { organizationId, userId, code }),
    // NOTE the param name: `instagram`, not `integration`. The web app keys off
    // this exact spelling; normalising it would break the toast silently.
    onSuccess: () =>
      oauthRedirect(INTEGRATIONS_PATH, { instagram: 'connected' }),
    onFailure: (message) =>
      oauthRedirect(INTEGRATIONS_PATH, {
        instagram: 'error',
        message: message ?? 'Failed to connect Instagram',
      }),
    onOutcome: (o) =>
      trackOrgEvent(
        o.organizationId,
        'integrations.instagram_connect.callback',
        {
          status: o.status === 'success' ? 'success' : o.status,
          errorCode: o.errorCode ?? null,
          error: o.error ?? null,
          errorDescription: o.errorDescription ?? null,
        }
      ),
  });

// --------------------------------------------------------------- stripe

export const completeStripeCallback = (
  db: DbConnection,
  a: OAuthCallbackArgs
) => {
  // `returnTo: 'onboarding'` is a SENTINEL, not a path — it does not start with
  // `/`, so safeReturnTo() would discard it. It is resolved here instead.
  const isOnboarding = a.state.returnTo === 'onboarding';
  return completeOAuthConnect({
    ...a,
    operation: 'integrations.stripeConnectOAuth',
    connect: ({ organizationId, userId, code }) =>
      connectStripe(db, { organizationId, userId, code }),
    onSuccess: (_d, returnPath) =>
      isOnboarding
        ? oauthRedirect('/onboarding', { stripe: 'connected' })
        : statusRedirect(returnPath, 'stripe', 'connected'),
    onFailure: (message, returnPath) =>
      statusRedirect(
        isOnboarding ? '/onboarding' : returnPath,
        'stripe',
        'error',
        message
      ),
  });
};

// -------------------------------------------------------------- booking

const bookingSuccess = (
  provider: 'calendly' | 'timely',
  accountId: string,
  returnPath: string
): OAuthRedirectResult =>
  oauthRedirect(returnPath, {
    integration: 'booking',
    status: 'connected',
    provider,
    accountId,
  });

export const completeCalendlyCallback = (
  db: DbConnection,
  a: OAuthCallbackArgs
) =>
  completeOAuthConnect({
    ...a,
    operation: 'integrations.calendlyOAuth',
    requireUserId: true,
    connect: ({ organizationId, userId, code }) =>
      connectCalendly(db, { organizationId, userId, code }),
    onSuccess: (data, returnPath) =>
      bookingSuccess('calendly', data.id, returnPath),
    // Failures go to a FIXED path, unlike successes. Preserved as found.
    onFailure: (message) =>
      statusRedirect(INTEGRATIONS_PATH, 'calendly', 'error', message),
  });

export const completeTimelyCallback = (
  db: DbConnection,
  a: OAuthCallbackArgs
) =>
  completeOAuthConnect({
    ...a,
    operation: 'integrations.timelyOAuth',
    requireUserId: true,
    connect: ({ organizationId, userId, code }) =>
      connectTimely(db, { organizationId, userId, code }),
    onSuccess: (data, returnPath) =>
      bookingSuccess('timely', data.id, returnPath),
    onFailure: (message) =>
      statusRedirect(INTEGRATIONS_PATH, 'timely', 'error', message),
  });

// --------------------------------------------------- google my business

export const completeGoogleMyBusinessCallback = (
  db: DbConnection,
  a: OAuthCallbackArgs
) =>
  completeOAuthConnect({
    ...a,
    operation: 'integrations.googleBusinessOAuth',
    requireUserId: true,
    connect: ({ organizationId, userId, code }) =>
      connectGoogleMyBusiness(db, {
        organizationId,
        userId,
        code,
        locationId: a.locationId || '',
        accountName: a.accountName || '',
      }),
    onSuccess: (_d, returnPath) =>
      statusRedirect(returnPath, 'google-my-business', 'connected'),
    onFailure: (message, returnPath) =>
      statusRedirect(returnPath, 'google-my-business', 'error', message),
  });
