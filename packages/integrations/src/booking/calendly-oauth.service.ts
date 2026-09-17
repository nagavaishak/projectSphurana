import { fetchWithRetry, fetchWithTimeout } from '@borradh-workspace/http';
import {
  type OAuthProxyConfig,
  getOAuthProxyConfig,
  signProxyState,
} from '../shared/oauth-proxy.js';
import type {
  BookingOAuthTokenResponse,
  CalendlyAvailableTime,
  CalendlyEventType,
  CalendlyUser,
} from './booking.types.js';

const CALENDLY_AUTH_URL = 'https://auth.calendly.com/oauth/authorize';
const CALENDLY_TOKEN_URL = 'https://auth.calendly.com/oauth/token';
const CALENDLY_API_BASE = 'https://api.calendly.com';

const PROXY_PROVIDER = 'calendly';
const DEFAULT_CALLBACK_PATH = '/integrations/booking/callback/calendly';

/**
 * Service for handling Calendly OAuth 2.0 flow and API interactions
 *
 * OAuth Flow:
 * 1. Redirect user to getAuthorizationUrl()
 * 2. User authorizes, Calendly redirects back with code
 * 3. Exchange code for tokens using exchangeCodeForTokens()
 * 4. Store encrypted tokens, use for API calls
 *
 * @see https://developer.calendly.com/getting-started
 */
export class CalendlyOAuthService {
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
    this.clientId = config?.clientId || process.env.CALENDLY_CLIENT_ID || '';
    this.clientSecret =
      config?.clientSecret || process.env.CALENDLY_CLIENT_SECRET || '';
    this.callbackPath = config?.callbackPath || DEFAULT_CALLBACK_PATH;
    this.proxyConfig = getOAuthProxyConfig();
    if (this.proxyConfig) {
      this.redirectUri = `${this.proxyConfig.baseUrl}/oauth/${PROXY_PROVIDER}/callback`;
    } else {
      this.redirectUri =
        config?.redirectUri || process.env.CALENDLY_OAUTH_REDIRECT_URI || '';
    }

    if (!this.clientId || !this.clientSecret) {
      console.warn(
        'CalendlyOAuthService: Missing CALENDLY_CLIENT_ID or CALENDLY_CLIENT_SECRET'
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
   * Generate the Calendly OAuth authorization URL
   * @param state Optional state parameter for CSRF protection
   * @returns The OAuth URL to redirect users to
   */
  getAuthorizationUrl(state?: string): string {
    const wrappedState = this.maybeWrapState(state);
    const params = new URLSearchParams({
      client_id: this.clientId,
      redirect_uri: this.redirectUri,
      response_type: 'code',
      ...(wrappedState && { state: wrappedState }),
    });

    return `${CALENDLY_AUTH_URL}?${params.toString()}`;
  }

  /**
   * Exchange authorization code for access and refresh tokens
   * Authorization codes expire after 10 minutes.
   * Access tokens expire after 2 hours.
   */
  async exchangeCodeForTokens(
    code: string
  ): Promise<BookingOAuthTokenResponse> {
    const response = await fetchWithTimeout(CALENDLY_TOKEN_URL, {
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
      refresh_token: string;
      token_type: string;
      expires_in: number;
      scope?: string;
      created_at?: number;
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
   * Refresh an expired access token
   */
  async refreshAccessToken(
    refreshToken: string
  ): Promise<BookingOAuthTokenResponse> {
    const response = await fetchWithRetry(CALENDLY_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: this.clientId,
        client_secret: this.clientSecret,
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
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
      scope?: string;
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
   * Get the authenticated user's info
   */
  async getCurrentUser(accessToken: string): Promise<CalendlyUser> {
    const response = await fetchWithRetry(`${CALENDLY_API_BASE}/users/me`, {
      headers: { Authorization: `Bearer ${accessToken}` },
      timeoutMs: 15000,
    });

    if (!response.ok) {
      const error = (await response.json()) as {
        title?: string;
        message?: string;
      };
      throw new Error(
        `Failed to get user info: ${error.message || error.title || 'Unknown error'}`
      );
    }

    const data = (await response.json()) as {
      resource: {
        uri: string;
        name: string;
        email: string;
        slug: string;
        scheduling_url: string;
        timezone: string;
        avatar_url?: string;
        current_organization?: string;
      };
    };

    return {
      uri: data.resource.uri,
      name: data.resource.name,
      email: data.resource.email,
      slug: data.resource.slug,
      schedulingUrl: data.resource.scheduling_url,
      timezone: data.resource.timezone,
      avatarUrl: data.resource.avatar_url,
      currentOrganization: data.resource.current_organization,
    };
  }

  /**
   * Get event types for a user
   */
  async getEventTypes(
    accessToken: string,
    userUri: string
  ): Promise<CalendlyEventType[]> {
    const params = new URLSearchParams({ user: userUri, active: 'true' });
    const response = await fetchWithRetry(
      `${CALENDLY_API_BASE}/event_types?${params.toString()}`,
      { headers: { Authorization: `Bearer ${accessToken}` }, timeoutMs: 15000 }
    );

    if (!response.ok) {
      throw new Error('Failed to get event types');
    }

    const data = (await response.json()) as {
      collection: Array<{
        uri: string;
        name: string;
        slug: string;
        active: boolean;
        duration: number;
        kind: 'solo' | 'group';
        scheduling_url: string;
        description_plain?: string;
        color?: string;
      }>;
    };

    return data.collection.map((et) => ({
      uri: et.uri,
      name: et.name,
      slug: et.slug,
      active: et.active,
      duration: et.duration,
      kind: et.kind,
      schedulingUrl: et.scheduling_url,
      description: et.description_plain,
      color: et.color,
    }));
  }

  /**
   * Get available times for an event type
   * Note: Limited to 7 days per request
   */
  async getAvailableTimes(
    accessToken: string,
    eventTypeUri: string,
    startTime: string,
    endTime: string
  ): Promise<CalendlyAvailableTime[]> {
    const params = new URLSearchParams({
      event_type: eventTypeUri,
      start_time: startTime,
      end_time: endTime,
    });

    const response = await fetchWithRetry(
      `${CALENDLY_API_BASE}/event_type_available_times?${params.toString()}`,
      { headers: { Authorization: `Bearer ${accessToken}` }, timeoutMs: 15000 }
    );

    if (!response.ok) {
      throw new Error('Failed to get available times');
    }

    const data = (await response.json()) as {
      collection: Array<{
        start_time: string;
        status: 'available' | 'unavailable';
        invitees_remaining?: number;
      }>;
    };

    return data.collection.map((slot) => ({
      startTime: slot.start_time,
      status: slot.status,
      inviteesRemaining: slot.invitees_remaining,
    }));
  }

  /**
   * Revoke access token
   */
  async revokeToken(accessToken: string): Promise<void> {
    const response = await fetchWithRetry(`${CALENDLY_TOKEN_URL}/introspect`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Authorization: `Basic ${Buffer.from(`${this.clientId}:${this.clientSecret}`).toString('base64')}`,
      },
      body: new URLSearchParams({
        token: accessToken,
      }),
      timeoutMs: 15000,
    });

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
