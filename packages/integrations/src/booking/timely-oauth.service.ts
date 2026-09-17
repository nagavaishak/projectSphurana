import { fetchWithRetry, fetchWithTimeout } from '@borradh-workspace/http';
import {
  type OAuthProxyConfig,
  getOAuthProxyConfig,
  signProxyState,
} from '../shared/oauth-proxy.js';
import type {
  BookingOAuthTokenResponse,
  TimelyAccount,
  TimelyBooking,
  TimelyService,
  TimelyStaff,
} from './booking.types.js';

const TIMELY_AUTH_URL = 'https://api.timelyapp.com/1.1/oauth/authorize';
const TIMELY_TOKEN_URL = 'https://api.timelyapp.com/1.1/oauth/token';
const TIMELY_API_BASE = 'https://api.timelyapp.com/1.1';

const PROXY_PROVIDER = 'timely';
const DEFAULT_CALLBACK_PATH = '/integrations/booking/callback/timely';

/**
 * Service for handling Timely OAuth 2.0 flow and API interactions
 *
 * OAuth Flow:
 * 1. Create OAuth app at https://app.timelyapp.com/:account_id/oauth_applications
 * 2. Redirect user to getAuthorizationUrl()
 * 3. User authorizes, Timely redirects back with code
 * 4. Exchange code for tokens using exchangeCodeForTokens()
 *
 * @see https://dev.timelyapp.com/
 */
export class TimelyOAuthService {
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
    this.clientId = config?.clientId || process.env.TIMELY_CLIENT_ID || '';
    this.clientSecret =
      config?.clientSecret || process.env.TIMELY_CLIENT_SECRET || '';
    this.callbackPath = config?.callbackPath || DEFAULT_CALLBACK_PATH;
    this.proxyConfig = getOAuthProxyConfig();
    if (this.proxyConfig) {
      this.redirectUri = `${this.proxyConfig.baseUrl}/oauth/${PROXY_PROVIDER}/callback`;
    } else {
      this.redirectUri =
        config?.redirectUri || process.env.TIMELY_OAUTH_REDIRECT_URI || '';
    }

    if (!this.clientId || !this.clientSecret) {
      console.warn(
        'TimelyOAuthService: Missing TIMELY_CLIENT_ID or TIMELY_CLIENT_SECRET'
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
   * Generate the Timely OAuth authorization URL
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

    return `${TIMELY_AUTH_URL}?${params.toString()}`;
  }

  /**
   * Exchange authorization code for access and refresh tokens
   */
  async exchangeCodeForTokens(
    code: string
  ): Promise<BookingOAuthTokenResponse> {
    const response = await fetchWithTimeout(TIMELY_TOKEN_URL, {
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
      expires_in?: number;
      scope?: string;
    };

    return {
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      tokenType: data.token_type,
      // Timely doesn't always return expires_in, default to 2 hours
      expiresIn: data.expires_in || 7200,
      scope: data.scope,
    };
  }

  /**
   * Refresh an expired access token
   */
  async refreshAccessToken(
    refreshToken: string
  ): Promise<BookingOAuthTokenResponse> {
    const response = await fetchWithRetry(TIMELY_TOKEN_URL, {
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
      expires_in?: number;
    };

    return {
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      tokenType: data.token_type,
      expiresIn: data.expires_in || 7200,
    };
  }

  /**
   * Get the authenticated user's accounts
   */
  async getAccounts(accessToken: string): Promise<TimelyAccount[]> {
    const response = await fetchWithRetry(`${TIMELY_API_BASE}/accounts`, {
      headers: { Authorization: `Bearer ${accessToken}` },
      timeoutMs: 15000,
    });

    if (!response.ok) {
      throw new Error('Failed to get accounts');
    }

    const data = (await response.json()) as Array<{
      id: number;
      name: string;
      email: string;
      logo_url?: string;
      timezone: string;
      currency: string;
    }>;

    return data.map((account) => ({
      id: account.id,
      name: account.name,
      email: account.email,
      logoUrl: account.logo_url,
      timezone: account.timezone,
      currency: account.currency,
    }));
  }

  /**
   * Get current user info
   */
  async getCurrentUser(
    accessToken: string,
    accountId: number
  ): Promise<{ id: number; name: string; email: string }> {
    const response = await fetchWithRetry(
      `${TIMELY_API_BASE}/${accountId}/users/current`,
      {
        headers: { Authorization: `Bearer ${accessToken}` },
        timeoutMs: 15000,
      }
    );

    if (!response.ok) {
      throw new Error('Failed to get current user');
    }

    const data = (await response.json()) as {
      id: number;
      name: string;
      email: string;
    };

    return data;
  }

  /**
   * Get bookings for an account
   */
  async getBookings(
    accessToken: string,
    accountId: number,
    startDate?: string,
    endDate?: string
  ): Promise<TimelyBooking[]> {
    const params = new URLSearchParams();
    if (startDate) params.set('since', startDate);
    if (endDate) params.set('until', endDate);

    const url = `${TIMELY_API_BASE}/${accountId}/events${params.toString() ? `?${params.toString()}` : ''}`;
    const response = await fetchWithRetry(url, {
      headers: { Authorization: `Bearer ${accessToken}` },
      timeoutMs: 15000,
    });

    if (!response.ok) {
      throw new Error('Failed to get bookings');
    }

    const data = (await response.json()) as Array<{
      id: number;
      day: string;
      from?: string;
      to?: string;
      state?: string;
      note?: string;
      user?: { name: string };
      project?: { name: string };
    }>;

    return data.map((booking) => ({
      id: booking.id,
      startTime: booking.from || booking.day,
      endTime: booking.to || booking.day,
      status:
        (booking.state as 'confirmed' | 'pending' | 'cancelled') || 'confirmed',
      staffName: booking.user?.name,
      serviceName: booking.project?.name,
      notes: booking.note,
    }));
  }

  /**
   * Create a booking
   */
  async createBooking(
    accessToken: string,
    accountId: number,
    booking: {
      projectId: number;
      day: string;
      from: string;
      to: string;
      note?: string;
    }
  ): Promise<TimelyBooking> {
    const response = await fetchWithTimeout(
      `${TIMELY_API_BASE}/${accountId}/events`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          event: {
            project_id: booking.projectId,
            day: booking.day,
            from: booking.from,
            to: booking.to,
            note: booking.note,
          },
        }),
        timeoutMs: 15000,
      }
    );

    if (!response.ok) {
      const error = await response.json();
      throw new Error(`Failed to create booking: ${JSON.stringify(error)}`);
    }

    const data = (await response.json()) as {
      id: number;
      day: string;
      from: string;
      to: string;
      state?: string;
      note?: string;
    };

    return {
      id: data.id,
      startTime: data.from,
      endTime: data.to,
      status: 'confirmed',
      notes: data.note,
    };
  }

  /**
   * Get projects (services) for an account
   */
  async getProjects(
    accessToken: string,
    accountId: number
  ): Promise<TimelyService[]> {
    const response = await fetchWithRetry(
      `${TIMELY_API_BASE}/${accountId}/projects`,
      {
        headers: { Authorization: `Bearer ${accessToken}` },
        timeoutMs: 15000,
      }
    );

    if (!response.ok) {
      throw new Error('Failed to get projects');
    }

    const data = (await response.json()) as Array<{
      id: number;
      name: string;
      budget?: number;
      budget_type?: string;
    }>;

    return data.map((project) => ({
      id: project.id,
      name: project.name,
      duration: 60, // Default duration, Timely projects don't have duration
      price: project.budget,
    }));
  }

  /**
   * Get users (staff) for an account
   */
  async getUsers(
    accessToken: string,
    accountId: number
  ): Promise<TimelyStaff[]> {
    const response = await fetchWithRetry(
      `${TIMELY_API_BASE}/${accountId}/users`,
      {
        headers: { Authorization: `Bearer ${accessToken}` },
        timeoutMs: 15000,
      }
    );

    if (!response.ok) {
      throw new Error('Failed to get users');
    }

    const data = (await response.json()) as Array<{
      id: number;
      name: string;
      email?: string;
      avatar_url?: string;
    }>;

    return data.map((user) => ({
      id: user.id,
      name: user.name,
      email: user.email,
      avatarUrl: user.avatar_url,
    }));
  }
}
