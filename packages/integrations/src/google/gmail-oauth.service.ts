import { fetchWithRetry, fetchWithTimeout } from '@borradh-workspace/http';
import {
  type OAuthProxyConfig,
  getOAuthProxyConfig,
  signProxyState,
} from '../shared/oauth-proxy.js';
import type {
  GoogleOAuthTokenResponse,
  GoogleUserInfo,
} from './google-oauth.types.js';

const GOOGLE_OAUTH_BASE = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const GOOGLE_USERINFO_URL = 'https://www.googleapis.com/oauth2/v2/userinfo';
const GOOGLE_REVOKE_URL = 'https://oauth2.googleapis.com/revoke';

const PROXY_PROVIDER = 'google';
const DEFAULT_CALLBACK_PATH = '/integrations/email/callback/gmail';

/**
 * Gmail OAuth scopes for sending emails
 */
const GMAIL_SCOPES = [
  'https://www.googleapis.com/auth/gmail.send',
  'https://www.googleapis.com/auth/gmail.compose',
  'https://www.googleapis.com/auth/userinfo.email',
  'https://www.googleapis.com/auth/userinfo.profile',
];

/**
 * Service for handling Gmail OAuth flow
 * Handles authorization, token exchange, and refresh
 */
export class GmailOAuthService {
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
    this.clientId = config?.clientId || process.env.GOOGLE_CLIENT_ID || '';
    this.clientSecret =
      config?.clientSecret || process.env.GOOGLE_CLIENT_SECRET || '';
    this.callbackPath = config?.callbackPath || DEFAULT_CALLBACK_PATH;
    this.proxyConfig = getOAuthProxyConfig();
    if (this.proxyConfig) {
      this.redirectUri = `${this.proxyConfig.baseUrl}/oauth/${PROXY_PROVIDER}/callback`;
    } else {
      this.redirectUri =
        config?.redirectUri ||
        process.env.GMAIL_OAUTH_REDIRECT_URI ||
        process.env.GOOGLE_OAUTH_REDIRECT_URI ||
        '';
    }

    if (!this.clientId || !this.clientSecret) {
      console.warn(
        'GmailOAuthService: Missing GOOGLE_CLIENT_ID or GOOGLE_CLIENT_SECRET environment variables'
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
   * Generate the Google OAuth authorization URL for Gmail
   * @param state Optional state parameter for CSRF protection
   * @returns The OAuth URL to redirect users to
   */
  getAuthorizationUrl(state?: string): string {
    const wrappedState = this.maybeWrapState(state);
    const params = new URLSearchParams({
      client_id: this.clientId,
      redirect_uri: this.redirectUri,
      scope: GMAIL_SCOPES.join(' '),
      response_type: 'code',
      access_type: 'offline', // Required to get refresh token
      prompt: 'consent', // Force consent to ensure refresh token
      ...(wrappedState && { state: wrappedState }),
    });

    return `${GOOGLE_OAUTH_BASE}?${params.toString()}`;
  }

  /**
   * Exchange authorization code for access and refresh tokens
   * @param code The authorization code from OAuth callback
   * @returns Token response with access and refresh tokens
   */
  async exchangeCodeForTokens(code: string): Promise<GoogleOAuthTokenResponse> {
    const response = await fetchWithTimeout(GOOGLE_TOKEN_URL, {
      timeoutMs: 15000,
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: this.clientId,
        client_secret: this.clientSecret,
        redirect_uri: this.redirectUri,
        grant_type: 'authorization_code',
        code,
      }),
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
  ): Promise<GoogleOAuthTokenResponse> {
    const response = await fetchWithRetry(GOOGLE_TOKEN_URL, {
      timeoutMs: 15000,
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: this.clientId,
        client_secret: this.clientSecret,
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
      }),
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
      token_type: string;
      expires_in: number;
      scope: string;
    };

    return {
      accessToken: data.access_token,
      tokenType: data.token_type,
      expiresIn: data.expires_in,
      scope: data.scope,
      // Note: refresh token is not returned on refresh, keep using original
    };
  }

  /**
   * Get the authenticated user's info
   * @param accessToken User access token
   * @returns User info including email
   */
  async getUserInfo(accessToken: string): Promise<GoogleUserInfo> {
    const response = await fetchWithRetry(GOOGLE_USERINFO_URL, {
      timeoutMs: 15000,
      headers: { Authorization: `Bearer ${accessToken}` },
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
      email: string;
      name: string;
      picture?: string;
      verified_email: boolean;
    };

    return {
      id: data.id,
      email: data.email,
      name: data.name,
      picture: data.picture,
      verifiedEmail: data.verified_email,
    };
  }

  /**
   * Revoke an access or refresh token
   * @param token Token to revoke
   */
  async revokeToken(token: string): Promise<void> {
    const response = await fetchWithRetry(
      `${GOOGLE_REVOKE_URL}?token=${token}`,
      {
        timeoutMs: 15000,
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      }
    );

    if (!response.ok) {
      const error = (await response.json()) as {
        error?: string;
        error_description?: string;
      };
      throw new Error(
        `Failed to revoke token: ${error.error_description || error.error || 'Unknown error'}`
      );
    }
  }
}
