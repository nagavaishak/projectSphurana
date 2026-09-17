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
const DEFAULT_CALLBACK_PATH = '/integrations/google-my-business/callback';

/**
 * Google My Business API scopes
 */
const GMB_SCOPES = [
  'https://www.googleapis.com/auth/business.manage',
  'https://www.googleapis.com/auth/userinfo.email',
  'https://www.googleapis.com/auth/userinfo.profile',
];

/**
 * GMB account info from the Account Management API
 */
export interface GmbAccountInfo {
  name: string; // e.g. "accounts/123456"
  accountName: string; // e.g. "My Business"
  type: string; // e.g. "PERSONAL", "LOCATION_GROUP", "ORGANIZATION"
}

/**
 * GMB location info
 */
export interface GmbLocationInfo {
  name: string; // e.g. "locations/456789"
  title: string; // Business name on Google
  placeId?: string;
  websiteUri?: string;
  phoneNumbers?: { primaryPhone?: string };
  address?: {
    locality?: string;
    regionCode?: string;
    postalCode?: string;
    addressLines?: string[];
  };
}

/**
 * GMB review from the Business Profile API
 */
export interface GmbReviewInfo {
  name: string; // e.g. "accounts/.../locations/.../reviews/..."
  reviewId: string;
  reviewer: {
    displayName: string;
    profilePhotoUrl?: string;
  };
  starRating: 'ONE' | 'TWO' | 'THREE' | 'FOUR' | 'FIVE';
  comment?: string;
  createTime: string;
  updateTime: string;
  reviewReply?: {
    comment: string;
    updateTime: string;
  };
}

/**
 * Service for handling Google My Business OAuth and API calls
 */
export class GoogleMyBusinessOAuthService {
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
        process.env.GOOGLE_GMB_OAUTH_REDIRECT_URI ||
        process.env.GOOGLE_OAUTH_REDIRECT_URI ||
        '';
    }

    if (!this.clientId || !this.clientSecret) {
      console.warn(
        'GoogleMyBusinessOAuthService: Missing GOOGLE_CLIENT_ID or GOOGLE_CLIENT_SECRET'
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
   * Generate the Google OAuth authorization URL for GMB
   */
  getAuthorizationUrl(state?: string): string {
    const wrappedState = this.maybeWrapState(state);
    const params = new URLSearchParams({
      client_id: this.clientId,
      redirect_uri: this.redirectUri,
      scope: GMB_SCOPES.join(' '),
      response_type: 'code',
      access_type: 'offline',
      prompt: 'consent',
      ...(wrappedState && { state: wrappedState }),
    });

    return `${GOOGLE_OAUTH_BASE}?${params.toString()}`;
  }

  /**
   * Exchange authorization code for access and refresh tokens
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
   * Refresh an expired access token
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
    };
  }

  /**
   * Get the authenticated user's info
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
   * Get list of GMB accounts the user has access to
   * https://developers.google.com/my-business/reference/accountmanagement/rest/v1/accounts/list
   */
  async getAccounts(accessToken: string): Promise<GmbAccountInfo[]> {
    const response = await fetchWithRetry(
      'https://mybusinessaccountmanagement.googleapis.com/v1/accounts',
      { timeoutMs: 15000, headers: { Authorization: `Bearer ${accessToken}` } }
    );

    if (!response.ok) {
      const error = (await response.json()) as {
        error?: { message?: string };
      };
      throw new Error(
        `Failed to get GMB accounts: ${error.error?.message || 'Unknown error'}`
      );
    }

    const data = (await response.json()) as {
      accounts?: Array<{
        name: string;
        accountName: string;
        type: string;
      }>;
    };

    return (data.accounts || []).map((account) => ({
      name: account.name,
      accountName: account.accountName,
      type: account.type,
    }));
  }

  /**
   * Get locations for a GMB account
   * https://developers.google.com/my-business/reference/businessinformation/rest/v1/accounts.locations/list
   */
  async getLocations(
    accountName: string,
    accessToken: string
  ): Promise<GmbLocationInfo[]> {
    const params = new URLSearchParams({
      readMask: 'name,title,metadata,storefrontAddress,websiteUri,phoneNumbers',
    });

    const response = await fetchWithRetry(
      `https://mybusinessbusinessinformation.googleapis.com/v1/${accountName}/locations?${params.toString()}`,
      { timeoutMs: 15000, headers: { Authorization: `Bearer ${accessToken}` } }
    );

    if (!response.ok) {
      const error = (await response.json()) as {
        error?: { message?: string };
      };
      throw new Error(
        `Failed to get locations: ${error.error?.message || 'Unknown error'}`
      );
    }

    const data = (await response.json()) as {
      locations?: Array<{
        name: string;
        title: string;
        metadata?: { placeId?: string };
        websiteUri?: string;
        phoneNumbers?: { primaryPhone?: string };
        storefrontAddress?: {
          locality?: string;
          regionCode?: string;
          postalCode?: string;
          addressLines?: string[];
        };
      }>;
    };

    return (data.locations || []).map((location) => ({
      name: location.name,
      title: location.title,
      placeId: location.metadata?.placeId,
      websiteUri: location.websiteUri,
      phoneNumbers: location.phoneNumbers,
      address: location.storefrontAddress
        ? {
            locality: location.storefrontAddress.locality,
            regionCode: location.storefrontAddress.regionCode,
            postalCode: location.storefrontAddress.postalCode,
            addressLines: location.storefrontAddress.addressLines,
          }
        : undefined,
    }));
  }

  /**
   * Get reviews for a location
   * https://developers.google.com/my-business/reference/rest/v4/accounts.locations.reviews/list
   */
  async getReviews(
    accountName: string,
    locationName: string,
    accessToken: string,
    pageSize = 50,
    pageToken?: string
  ): Promise<{
    reviews: GmbReviewInfo[];
    nextPageToken?: string;
    totalReviewCount?: number;
    averageRating?: number;
  }> {
    const params = new URLSearchParams({
      pageSize: String(pageSize),
      ...(pageToken && { pageToken }),
    });

    // The reviews API uses v4 endpoint
    const response = await fetchWithRetry(
      `https://mybusiness.googleapis.com/v4/${accountName}/${locationName}/reviews?${params.toString()}`,
      { timeoutMs: 15000, headers: { Authorization: `Bearer ${accessToken}` } }
    );

    if (!response.ok) {
      const error = (await response.json()) as {
        error?: { message?: string };
      };
      throw new Error(
        `Failed to get reviews: ${error.error?.message || 'Unknown error'}`
      );
    }

    const data = (await response.json()) as {
      reviews?: Array<{
        name: string;
        reviewId: string;
        reviewer: {
          displayName: string;
          profilePhotoUrl?: string;
        };
        starRating: 'ONE' | 'TWO' | 'THREE' | 'FOUR' | 'FIVE';
        comment?: string;
        createTime: string;
        updateTime: string;
        reviewReply?: {
          comment: string;
          updateTime: string;
        };
      }>;
      nextPageToken?: string;
      totalReviewCount?: number;
      averageRating?: number;
    };

    return {
      reviews: (data.reviews || []).map((review) => ({
        name: review.name,
        reviewId: review.reviewId,
        reviewer: {
          displayName: review.reviewer.displayName,
          profilePhotoUrl: review.reviewer.profilePhotoUrl,
        },
        starRating: review.starRating,
        comment: review.comment,
        createTime: review.createTime,
        updateTime: review.updateTime,
        reviewReply: review.reviewReply,
      })),
      nextPageToken: data.nextPageToken,
      totalReviewCount: data.totalReviewCount,
      averageRating: data.averageRating,
    };
  }

  /**
   * Revoke an access or refresh token
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

/**
 * Convert Google star rating string to number
 */
export function starRatingToNumber(
  rating: 'ONE' | 'TWO' | 'THREE' | 'FOUR' | 'FIVE'
): number {
  const map: Record<string, number> = {
    ONE: 1,
    TWO: 2,
    THREE: 3,
    FOUR: 4,
    FIVE: 5,
  };
  return map[rating] || 0;
}

/**
 * Generate a Google review link from a Place ID
 */
export function buildReviewLink(placeId: string): string {
  return `https://search.google.com/local/writereview?placeid=${placeId}`;
}
