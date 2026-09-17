import { apiEnv } from '@borradh-workspace/env/api';
import { trackedResult } from '@borradh-workspace/observability';
import {
  ErrorCodes,
  FeatureError,
  type Result,
  err,
  ok,
} from '../../../shared/index.js';

export interface SelfServeMetaLink {
  /** The link to send a prospect. Reusable — the same URL for everyone. */
  url: string;
  /**
   * The redirect URI baked into it. Surfaced because Meta rejects the flow
   * unless this exact string is listed under Valid OAuth Redirect URIs, and
   * that is the one setup step nothing in the product can do for you.
   */
  redirectUri: string;
}

const SELF_SERVE_CALLBACK_PATH = '/integrations/meta/self-serve/callback';
const DIALOG = 'https://www.facebook.com/v21.0/dialog/oauth';

/**
 * The shareable Facebook Login for Business link, built from platform config.
 *
 * REDIRECT mode, not the in-app popup. The popup returns its code in-page and
 * the API reads the organization from the session, which makes it useless for
 * a prospect who has no Borradh account yet — and that is exactly who this is
 * for. Here the callback lands org-less, parks the connection, and an operator
 * attaches it to a workspace afterwards.
 *
 * Permissions come from the CONFIGURATION, not from a scope list here. That is
 * the property worth having: a config is edited in one place in the Meta app
 * and cannot be half-granted by the person clicking through, which is how the
 * partner-access route loses lead retrieval on most clients.
 */
const getSelfServeMetaLinkImpl = (): Result<SelfServeMetaLink> => {
  const apiUrl = apiEnv.API_URL?.replace(/\/+$/, '');
  if (!apiUrl) {
    return err(
      new FeatureError(
        ErrorCodes.INVALID_STATE,
        'API_URL is not configured, so the callback URL for the onboarding link cannot be built.'
      )
    );
  }

  const appId = apiEnv.META_APP_ID?.trim();
  if (!appId) {
    return err(
      new FeatureError(
        ErrorCodes.INVALID_STATE,
        'META_APP_ID is not configured, so no onboarding link can be built.'
      )
    );
  }

  const configId = apiEnv.META_LOGIN_CONFIG_ID?.trim();
  if (!configId) {
    return err(
      new FeatureError(
        ErrorCodes.INVALID_STATE,
        'META_LOGIN_CONFIG_ID is not configured. Create a Facebook Login for Business configuration in the Meta app and set its id — without one this is an ordinary consumer login, which does not mint a business token.'
      )
    );
  }

  const redirectUri = `${apiUrl}${SELF_SERVE_CALLBACK_PATH}`;
  const params = new URLSearchParams({
    client_id: appId,
    config_id: configId,
    redirect_uri: redirectUri,
    response_type: 'code',
    // No `scope`: an FLfB configuration carries its own permission set, and
    // passing scope alongside config_id makes Meta ignore the configuration.
  });

  return ok({ url: `${DIALOG}?${params.toString()}`, redirectUri });
};

/** The shareable Meta onboarding link for this environment. */
export const getSelfServeMetaLink = () =>
  trackedResult(
    'integrations.getSelfServeMetaLink',
    async () => getSelfServeMetaLinkImpl(),
    { trackSuccess: false }
  );

export type GetSelfServeMetaLinkResult = Awaited<
  ReturnType<typeof getSelfServeMetaLink>
>;
