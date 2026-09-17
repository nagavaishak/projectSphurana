import { fetchWithRetry, fetchWithTimeout } from '@borradh-workspace/http';
import {
  type OAuthProxyConfig,
  getOAuthProxyConfig,
  signProxyState,
} from '../shared/oauth-proxy.js';
import type {
  MicrosoftOAuthTokenResponse,
  MicrosoftUserInfo,
} from './microsoft-oauth.types.js';

const MICROSOFT_AUTH_BASE =
  'https://login.microsoftonline.com/common/oauth2/v2.0';
const MICROSOFT_GRAPH_BASE = 'https://graph.microsoft.com/v1.0';

const PROXY_PROVIDER = 'microsoft';
const DEFAULT_CALLBACK_PATH = '/integrations/email/callback/outlook';

/**
 * Microsoft Graph scopes for sending emails via Outlook
 */
const OUTLOOK_SCOPES = [
  'https://graph.microsoft.com/Mail.Send',
  'https://graph.microsoft.com/User.Read',
  'offline_access',
];

/**
 * Service for handling Outlook OAuth flow via Microsoft Identity Platform
 */
export class OutlookOAuthService {
  private clientId: string;
  private clientSecret: string;
  private redirectUri: string;
  private proxyConfig: OAuthProxyConfig | null;
  private callbackPath: string;

  constructor(config?: {
    clientId?: string;
    clientSecret?: string;
    redirectUri?: string;
    callbackPath?: string;
  }) {
    this.clientId = config?.clientId || process.env.MICROSOFT_CLIENT_ID || '';
    this.clientSecret =
      config?.clientSecret || process.env.MICROSOFT_CLIENT_SECRET || '';
    this.callbackPath = config?.callbackPath || DEFAULT_CALLBACK_PATH;
    this.proxyConfig = getOAuthProxyConfig();
    if (this.proxyConfig) {
      this.redirectUri = `${this.proxyConfig.baseUrl}/oauth/${PROXY_PROVIDER}/callback`;
    } else {
      this.redirectUri =
        config?.redirectUri || process.env.MICROSOFT_OAUTH_REDIRECT_URI || '';
    }

    if (!this.clientId || !this.clientSecret) {
      console.warn(
        'OutlookOAuthService: Missing MICROSOFT_CLIENT_ID or MICROSOFT_CLIENT_SECRET environment variables'
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
   * Generate the Microsoft OAuth authorization URL
   * @param state Optional state parameter for CSRF protection
   * @returns The OAuth URL to redirect users to
   */
  getAuthorizationUrl(state?: string): string {
    const wrappedState = this.maybeWrapState(state);
    const params = new URLSearchParams({
      client_id: this.clientId,
      redirect_uri: this.redirectUri,
      scope: OUTLOOK_SCOPES.join(' '),
      response_type: 'code',
      response_mode: 'query',
      ...(wrappedState && { state: wrappedState }),
    });

    return `${MICROSOFT_AUTH_BASE}/authorize?${params.toString()}`;
  }

  /**
   * Exchange authorization code for access and refresh tokens
   * @param code The authorization code from OAuth callback
   * @returns Token response with access and refresh tokens
   */
  async exchangeCodeForTokens(
    code: string
  ): Promise<MicrosoftOAuthTokenResponse> {
    const response = await fetchWithTimeout(`${MICROSOFT_AUTH_BASE}/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: this.clientId,
        client_secret: this.clientSecret,
        redirect_uri: this.redirectUri,
        grant_type: 'authorization_code',
        code,
      }),
      timeoutMs: 15000,
    });

    if (!response.ok) {
      const error = (await response.json()) as {
        error?: string;
        error_description?: string;
      };
      throw new Error(
        `Failed to exchange code: ${error.error_description || error.error || 'Unknown error'}`
      );
    }

    const data = (await response.json()) as {
      access_token: string;
      refresh_token?: string;
      token_type: string;
      expires_in: number;
      scope: string;
    };

    return {
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      tokenType: data.token_type,
      expiresIn: data.expires_in,
      scope: data.scope,
    };
  }

  /**
   * Refresh an expired access token using the refresh token
   * @param refreshToken The refresh token
   * @returns New token response
   */
  async refreshAccessToken(
    refreshToken: string
  ): Promise<MicrosoftOAuthTokenResponse> {
    const response = await fetchWithRetry(`${MICROSOFT_AUTH_BASE}/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: this.clientId,
        client_secret: this.clientSecret,
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
        scope: OUTLOOK_SCOPES.join(' '),
      }),
      timeoutMs: 15000,
    });

    if (!response.ok) {
      const error = (await response.json()) as {
        error?: string;
        error_description?: string;
      };
      throw new Error(
        `Failed to refresh token: ${error.error_description || error.error || 'Unknown error'}`
      );
    }

    const data = (await response.json()) as {
      access_token: string;
      refresh_token?: string;
      token_type: string;
      expires_in: number;
      scope: string;
    };

    return {
      accessToken: data.access_token,
      refreshToken: data.refresh_token, // Microsoft returns new refresh token
      tokenType: data.token_type,
      expiresIn: data.expires_in,
      scope: data.scope,
    };
  }

  /**
   * Get the authenticated user's info from Microsoft Graph
   * @param accessToken User access token
   * @returns User info including email
   */
  async getUserInfo(accessToken: string): Promise<MicrosoftUserInfo> {
    const response = await fetchWithRetry(`${MICROSOFT_GRAPH_BASE}/me`, {
      headers: { Authorization: `Bearer ${accessToken}` },
      timeoutMs: 15000,
    });

    if (!response.ok) {
      const error = (await response.json()) as {
        error?: { message?: string };
      };
      throw new Error(
        `Failed to get user info: ${error.error?.message || 'Unknown error'}`
      );
    }

    const data = (await response.json()) as {
      id: string;
      displayName: string;
      mail: string;
      userPrincipalName: string;
    };

    return {
      id: data.id,
      displayName: data.displayName,
      mail: data.mail || data.userPrincipalName,
      userPrincipalName: data.userPrincipalName,
    };
  }

  /**
   * Revoke access (Microsoft doesn't have a direct revoke endpoint,
   * but we can sign out the user from our app)
   */
  async revokeAccess(): Promise<void> {
    // Microsoft Graph doesn't have a programmatic revoke endpoint
    // Users must revoke access from their Microsoft account settings
    // This is a placeholder for any cleanup logic
    console.log(
      'Microsoft OAuth: Access should be revoked from Microsoft account settings'
    );
  }
}
