import { fetchWithRetry, fetchWithTimeout } from '@borradh-workspace/http';
import {
  INSTAGRAM_GRAPH_HOST,
  INSTAGRAM_OAUTH_API_VERSION,
} from '../shared/graph-api.js';
import {
  type OAuthProxyConfig,
  getOAuthProxyConfig,
  signProxyState,
} from '../shared/oauth-proxy.js';
import { instagramSubscribedFields } from '../webhooks/index.js';
import type {
  InstagramLongLivedTokenResponse,
  InstagramTokenResponse,
  InstagramUserProfile,
} from './instagram-oauth.types.js';

// OAuth was already on v24 before the consolidation — unchanged.
const INSTAGRAM_API_VERSION = INSTAGRAM_OAUTH_API_VERSION;
const INSTAGRAM_GRAPH_BASE = INSTAGRAM_GRAPH_HOST;

const PROXY_PROVIDER = 'instagram';
const DEFAULT_CALLBACK_PATH = '/integrations/instagram/callback';

/**
 * Service for handling Instagram Login API OAuth flow
 * Uses the Instagram Login API (separate from the Facebook Login flow)
 */
export class InstagramOAuthService {
  private appId: string;
  private appSecret: string;
  private redirectUri: string;
  private proxyConfig: OAuthProxyConfig | null;
  private callbackPath: string;

  constructor(config?: {
    appId?: string;
    appSecret?: string;
    redirectUri?: string;
    callbackPath?: string;
  }) {
    this.appId = config?.appId || process.env.INSTAGRAM_APP_ID || '';
    this.appSecret =
      config?.appSecret || process.env.META_INSTAGRAM_APP_SECRET || '';
    this.callbackPath = config?.callbackPath || DEFAULT_CALLBACK_PATH;
    this.proxyConfig = getOAuthProxyConfig();
    if (this.proxyConfig) {
      this.redirectUri = `${this.proxyConfig.baseUrl}/oauth/${PROXY_PROVIDER}/callback`;
    } else {
      this.redirectUri =
        config?.redirectUri || process.env.INSTAGRAM_OAUTH_REDIRECT_URI || '';
    }

    if (!this.appId || !this.appSecret) {
      console.warn(
        'InstagramOAuthService: Missing INSTAGRAM_APP_ID or META_INSTAGRAM_APP_SECRET environment variables'
      );
    }
  }

  private maybeWrapState(state: string | undefined): string | undefined {
    if (!state || !this.proxyConfig) return state;
    return (
      signProxyState(
        { callbackPath: this.callbackPath, inner: state },
        this.proxyConfig
      ) ?? state
    );
  }

  /**
   * Generate the Instagram OAuth authorization URL
   * @param state Optional state parameter for CSRF protection
   * @returns The OAuth URL to redirect users to
   */
  getAuthorizationUrl(state?: string): string {
    const scopes = [
      'instagram_business_basic',
      'instagram_business_content_publish',
      'instagram_business_manage_messages',
      'instagram_business_manage_comments',
    ].join(',');

    const wrappedState = this.maybeWrapState(state);
    const params = new URLSearchParams({
      client_id: this.appId,
      redirect_uri: this.redirectUri,
      response_type: 'code',
      scope: scopes,
      ...(wrappedState && { state: wrappedState }),
    });

    return `https://www.instagram.com/oauth/authorize?${params.toString()}`;
  }

  /**
   * Exchange authorization code for a short-lived access token
   * Instagram requires form-encoded body (NOT query params)
   * @param code The authorization code from OAuth callback
   * @returns Short-lived access token and user ID
   */
  async exchangeCodeForToken(
    code: string
  ): Promise<{ accessToken: string; userId: string }> {
    const body = new URLSearchParams({
      client_id: this.appId,
      client_secret: this.appSecret,
      grant_type: 'authorization_code',
      redirect_uri: this.redirectUri,
      code,
    });

    const response = await fetchWithTimeout(
      'https://api.instagram.com/oauth/access_token',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: body.toString(),
        timeoutMs: 15000,
      }
    );

    if (!response.ok) {
      const error = (await response.json()) as {
        error_message?: string;
      };
      throw new Error(
        `Failed to exchange code: ${error.error_message || 'Unknown error'}`
      );
    }

    const data = (await response.json()) as InstagramTokenResponse;
    return {
      accessToken: data.access_token,
      userId: String(data.user_id),
    };
  }

  /**
   * Exchange short-lived token for long-lived token (60 days)
   * @param shortLivedToken The short-lived access token
   * @returns Long-lived token response
   */
  async exchangeForLongLivedToken(
    shortLivedToken: string
  ): Promise<{ accessToken: string; tokenType: string; expiresIn: number }> {
    const params = new URLSearchParams({
      grant_type: 'ig_exchange_token',
      client_secret: this.appSecret,
      access_token: shortLivedToken,
    });

    const response = await fetchWithRetry(
      `${INSTAGRAM_GRAPH_BASE}/access_token?${params.toString()}`,
      { timeoutMs: 15000 }
    );

    if (!response.ok) {
      const error = (await response.json()) as {
        error?: { message?: string };
      };
      throw new Error(
        `Failed to get long-lived token: ${error.error?.message || 'Unknown error'}`
      );
    }

    const data = (await response.json()) as InstagramLongLivedTokenResponse;
    return {
      accessToken: data.access_token,
      tokenType: data.token_type,
      expiresIn: data.expires_in,
    };
  }

  /**
   * Refresh a long-lived token before it expires
   * @param currentToken The current long-lived access token
   * @returns New long-lived token response
   */
  async refreshLongLivedToken(
    currentToken: string
  ): Promise<{ accessToken: string; tokenType: string; expiresIn: number }> {
    const params = new URLSearchParams({
      grant_type: 'ig_refresh_token',
      access_token: currentToken,
    });

    const response = await fetchWithRetry(
      `${INSTAGRAM_GRAPH_BASE}/refresh_access_token?${params.toString()}`,
      { timeoutMs: 15000 }
    );

    if (!response.ok) {
      const error = (await response.json()) as {
        error?: { message?: string };
      };
      throw new Error(
        `Failed to refresh long-lived token: ${error.error?.message || 'Unknown error'}`
      );
    }

    const data = (await response.json()) as InstagramLongLivedTokenResponse;
    return {
      accessToken: data.access_token,
      tokenType: data.token_type,
      expiresIn: data.expires_in,
    };
  }

  /**
   * Subscribe an Instagram account to receive webhooks (messages, comments, etc.)
   * Must be called after the user authorizes the app via OAuth.
   * @param accessToken User's long-lived access token
   * @param fields Webhook fields to subscribe to
   * @returns Success status
   */
  async subscribeToWebhooks(
    accessToken: string,
    fields: readonly string[] = instagramSubscribedFields
  ): Promise<boolean> {
    const params = new URLSearchParams({
      subscribed_fields: fields.join(','),
      access_token: accessToken,
    });

    const response = await fetchWithRetry(
      `${INSTAGRAM_GRAPH_BASE}/${INSTAGRAM_API_VERSION}/me/subscribed_apps?${params.toString()}`,
      { method: 'POST', timeoutMs: 15000 }
    );

    if (!response.ok) {
      const error = (await response.json()) as {
        error?: { message?: string };
      };
      throw new Error(
        `Failed to subscribe to Instagram webhooks: ${error.error?.message || 'Unknown error'}`
      );
    }

    const data = (await response.json()) as { success: boolean };
    return data.success;
  }

  /**
   * Get the authenticated user's profile
   * @param accessToken User access token
   * @returns User profile
   */
  async getUserProfile(accessToken: string): Promise<InstagramUserProfile> {
    const response = await fetchWithRetry(
      `${INSTAGRAM_GRAPH_BASE}/${INSTAGRAM_API_VERSION}/me?fields=id,user_id,username,name,profile_picture_url,account_type&access_token=${accessToken}`,
      { timeoutMs: 15000 }
    );

    if (!response.ok) {
      const error = (await response.json()) as {
        error?: { message?: string };
      };
      throw new Error(
        `Failed to get user profile: ${error.error?.message || 'Unknown error'}`
      );
    }

    return (await response.json()) as InstagramUserProfile;
  }
}
