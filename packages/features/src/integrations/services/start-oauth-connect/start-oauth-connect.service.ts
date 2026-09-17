import { trackOrgEvent } from '@borradh-workspace/observability';
import {
  ErrorCodes,
  FeatureError,
  type OAuthRedirectResult,
  type Result,
  err,
  externalRedirect,
  ok,
  safeReturnTo,
  signOAuthState,
} from '../../../shared/index.js';

/**
 * The OUTBOUND leg of every provider connect flow: mint a signed `state` and
 * send the browser to the provider's consent screen.
 *
 * This was eight near-identical handler bodies. They shared a bug worth
 * recording, because it is the reason the signing work touched this side too:
 *
 *   `JSON.stringify` DROPS keys whose value is `undefined`. So when a session
 *   had no active organization, the old code silently produced a state with no
 *   `organizationId` — and the user completed the entire round trip with the
 *   provider before being told "Connection expired", a message that is both
 *   wrong and unactionable. Only the Meta Ads handler had grown a guard against
 *   it; the other seven had not.
 *
 * Requiring `organizationId` here fixes that for all of them at once, and the
 * failure now happens at the point where the cause is still known.
 *
 * WHY THE PROVIDER SDKs ARE IMPORTED LAZILY. A static import of
 * `@borradh-workspace/integrations` from a service that the assistant's tool
 * graph can reach pulls the Meta SDK (ESM) into every spec that so much as
 * builds a tool context — nine unrelated suites went red on module load the
 * last time this happened, and it is documented in
 * capability-architecture.md's step-4 note. `await import(...)` inside the call
 * keeps that edge out of the module graph.
 */

export interface StartOAuthConnectInput {
  organizationId: string | undefined;
  userId: string;
  returnTo?: string;
}

const NO_ORG =
  'No active business selected. Please reload the page and try again.';

function requireOrg(organizationId: string | undefined): Result<string> {
  if (!organizationId) {
    return err(new FeatureError(ErrorCodes.VALIDATION_ERROR, NO_ORG));
  }
  return ok(organizationId);
}

async function start(
  input: StartOAuthConnectInput,
  provider: string,
  startedEvent: string | undefined,
  authorizeUrl: (state: string) => Promise<string> | string,
  opts: { withReturnTo?: boolean } = {}
): Promise<Result<OAuthRedirectResult>> {
  const org = requireOrg(input.organizationId);
  if (!org.success) return org;
  const organizationId = org.data;

  const state = signOAuthState({
    organizationId,
    userId: input.userId,
    provider,
    returnTo: opts.withReturnTo ? safeReturnTo(input.returnTo) : undefined,
  });
  if (!state) {
    return err(
      new FeatureError(ErrorCodes.INTERNAL_ERROR, 'OAuth is not configured')
    );
  }

  if (startedEvent) {
    trackOrgEvent(organizationId, startedEvent, {
      userId: input.userId,
      initiator: 'redirect',
    });
  }

  return ok(externalRedirect(await authorizeUrl(state)));
}

export const startGmailConnect = async (i: StartOAuthConnectInput) =>
  start(i, 'gmail', undefined, async (state) => {
    const { GmailOAuthService } = await import(
      '@borradh-workspace/integrations'
    );
    return new GmailOAuthService().getAuthorizationUrl(state);
  });

export const startOutlookConnect = async (i: StartOAuthConnectInput) =>
  start(i, 'outlook', undefined, async (state) => {
    const { OutlookOAuthService } = await import(
      '@borradh-workspace/integrations'
    );
    return new OutlookOAuthService().getAuthorizationUrl(state);
  });

export const startGoogleCalendarConnect = async (i: StartOAuthConnectInput) =>
  start(
    i,
    'google_calendar',
    undefined,
    async (state) => {
      const { GoogleCalendarOAuthService } = await import(
        '@borradh-workspace/integrations'
      );
      return new GoogleCalendarOAuthService().getAuthorizationUrl(state);
    },
    { withReturnTo: true }
  );

export const startCalendlyConnect = async (i: StartOAuthConnectInput) =>
  start(
    i,
    'calendly',
    undefined,
    async (state) => {
      const { CalendlyOAuthService } = await import(
        '@borradh-workspace/integrations'
      );
      return new CalendlyOAuthService().getAuthorizationUrl(state);
    },
    { withReturnTo: true }
  );

export const startTimelyConnect = async (i: StartOAuthConnectInput) =>
  start(
    i,
    'timely',
    undefined,
    async (state) => {
      const { TimelyOAuthService } = await import(
        '@borradh-workspace/integrations'
      );
      return new TimelyOAuthService().getAuthorizationUrl(state);
    },
    { withReturnTo: true }
  );

export const startGoogleMyBusinessConnect = async (i: StartOAuthConnectInput) =>
  start(
    i,
    'google_my_business',
    undefined,
    async (state) => {
      const { GoogleMyBusinessOAuthService } = await import(
        '@borradh-workspace/integrations'
      );
      return new GoogleMyBusinessOAuthService().getAuthorizationUrl(state);
    },
    { withReturnTo: true }
  );

export const startMetaAdsConnect = async (i: StartOAuthConnectInput) =>
  start(
    i,
    'meta_ads',
    'integrations.meta_ads_connect.started',
    async (state) => {
      const { MetaOAuthService } = await import(
        '@borradh-workspace/integrations/meta-ads'
      );
      return new MetaOAuthService().getAuthorizationUrl(state);
    }
  );

/**
 * Instagram is reached two ways — a browser redirect (`instagram/auth`) and a
 * JSON fetch of the URL (`instagram/authorize-url`) — so the URL itself is
 * exposed separately from the redirect outcome.
 */
export const instagramAuthorizeUrl = async (
  input: StartOAuthConnectInput
): Promise<Result<string>> => {
  const org = requireOrg(input.organizationId);
  if (!org.success) return org;

  const state = signOAuthState({
    organizationId: org.data,
    userId: input.userId,
    provider: 'instagram',
  });
  if (!state) {
    return err(
      new FeatureError(ErrorCodes.INTERNAL_ERROR, 'OAuth is not configured')
    );
  }

  const { apiEnv } = await import('@borradh-workspace/env/api');
  const { InstagramOAuthService } = await import(
    '@borradh-workspace/integrations'
  );
  return ok(
    new InstagramOAuthService({
      appId: apiEnv.INSTAGRAM_APP_ID,
      appSecret: apiEnv.META_INSTAGRAM_APP_SECRET,
      redirectUri: apiEnv.INSTAGRAM_OAUTH_REDIRECT_URI,
    }).getAuthorizationUrl(state)
  );
};

export const startInstagramConnect = async (
  input: StartOAuthConnectInput
): Promise<Result<OAuthRedirectResult>> => {
  const url = await instagramAuthorizeUrl(input);
  if (!url.success) return url;
  if (input.organizationId) {
    trackOrgEvent(
      input.organizationId,
      'integrations.instagram_connect.started',
      { userId: input.userId, initiator: 'redirect' }
    );
  }
  return ok(externalRedirect(url.data));
};

/**
 * Stripe's authorize URL is built by `initiateStripeConnect` (it needs db
 * access for the org's email), so this only owns the transport-shaped part the
 * controller was carrying: resolving the callback URL and sanitising returnTo.
 */
export const startStripeConnect = async (
  db: Parameters<
    typeof import('../initiate-stripe-connect/index.js').initiateStripeConnect
  >[0],
  input: StartOAuthConnectInput
): Promise<Result<{ authUrl: string }>> => {
  const org = requireOrg(input.organizationId);
  if (!org.success) return org;

  const { apiEnv } = await import('@borradh-workspace/env/api');
  const apiUrl = apiEnv.API_URL;
  if (!apiUrl) {
    return err(
      new FeatureError(ErrorCodes.INTERNAL_ERROR, 'API_URL is not configured')
    );
  }

  const { initiateStripeConnect } = await import(
    '../initiate-stripe-connect/index.js'
  );
  const result = await initiateStripeConnect(db, {
    organizationId: org.data,
    userId: input.userId,
    redirectUri: `${apiUrl}/integrations/stripe/callback`,
    returnTo: safeReturnTo(input.returnTo),
  });
  if (!result.success) return result as Result<never>;
  return ok({ authUrl: result.data.url });
};

/**
 * Wizard helpers: the Meta Ads selection wizard fetches ad accounts and pages
 * with the temporary access token before the integration row is configured.
 * They were the last two places the controller reached for a provider SDK.
 */
export const listMetaAdAccountsForWizard = async (
  accessToken: string
): Promise<Result<{ adAccounts: unknown[] }>> => {
  const { logError } = await import('@borradh-workspace/observability');
  try {
    const { MetaOAuthService } = await import(
      '@borradh-workspace/integrations/meta-ads'
    );
    return ok({
      adAccounts: await new MetaOAuthService().getAdAccounts(accessToken),
    });
  } catch (error) {
    logError('integrations.fetchAdAccounts', error, {
      feature: 'integrations',
    });
    return err(
      new FeatureError(
        ErrorCodes.VALIDATION_ERROR,
        'Failed to fetch ad accounts'
      )
    );
  }
};

export const listMetaPagesForWizard = async (
  accessToken: string
): Promise<Result<{ pages: unknown[] }>> => {
  const { logError } = await import('@borradh-workspace/observability');
  try {
    const { MetaOAuthService } = await import(
      '@borradh-workspace/integrations/meta-ads'
    );
    return ok({ pages: await new MetaOAuthService().getPages(accessToken) });
  } catch (error) {
    logError('integrations.fetchPages', error, { feature: 'integrations' });
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Failed to fetch pages')
    );
  }
};
