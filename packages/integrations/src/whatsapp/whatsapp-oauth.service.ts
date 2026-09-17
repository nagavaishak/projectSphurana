/**
 * WhatsApp Embedded Signup — server-side Graph API helpers.
 *
 * Used after the customer completes Meta's Embedded Signup popup on the
 * frontend. The popup returns an authorization `code` via the FB JS SDK
 * callback and a `waba_id` via a `postMessage` event. This service:
 *
 *   1. Exchanges the code for a long-lived business token (biSUAT).
 *   2. Fetches phone numbers attached to the WABA.
 *   3. Subscribes our app to webhooks for the WABA.
 *
 * It does NOT register phone numbers — Meta's Embedded Signup (Coexistence
 * and standard Cloud API flows) handles registration internally. Calling
 * `/register` from here fails for SMB-managed numbers with
 * "Register endpoint is not available for SMB businesses."
 */

import { fetchWithRetry, fetchWithTimeout } from '@borradh-workspace/http';
import { logError } from '@borradh-workspace/observability';
import { GRAPH_API_BASE } from '../shared/graph-api.js';

export interface WhatsAppPhoneNumber {
  id: string;
  displayPhoneNumber: string;
  verifiedName: string;
  qualityRating: string;
  codeVerificationStatus: string;
}

export interface WhatsAppOAuthTokenResponse {
  accessToken: string;
  tokenType: string;
  expiresIn: number;
}

export class WhatsAppOAuthService {
  private appId: string;
  private appSecret: string;

  constructor(config?: { appId?: string; appSecret?: string }) {
    this.appId = config?.appId || process.env.META_APP_ID || '';
    this.appSecret = config?.appSecret || process.env.META_APP_SECRET || '';

    if (!this.appId || !this.appSecret) {
      console.warn(
        'WhatsAppOAuthService: Missing META_APP_ID or META_APP_SECRET environment variables'
      );
    }
  }

  /**
   * Exchange the short-lived code returned by the Embedded Signup popup for
   * a business token. Note: no redirect_uri is sent — FLfB popups return the
   * code directly via the JS SDK, so the exchange is redirect-less.
   */
  async exchangeCodeForToken(
    code: string
  ): Promise<WhatsAppOAuthTokenResponse> {
    const params = new URLSearchParams({
      client_id: this.appId,
      client_secret: this.appSecret,
      code,
    });

    const response = await fetchWithTimeout(
      `${GRAPH_API_BASE}/oauth/access_token?${params.toString()}`,
      { timeoutMs: 15000 }
    );

    if (!response.ok) {
      const body = await response.text();
      throw new Error(
        `Meta oauth/access_token failed: ${response.status} ${body}`
      );
    }

    const data = (await response.json()) as {
      access_token: string;
      token_type: string;
      expires_in: number;
    };

    return {
      accessToken: data.access_token,
      tokenType: data.token_type,
      expiresIn: data.expires_in,
    };
  }

  /**
   * Get phone numbers attached to a WhatsApp Business Account.
   */
  async getPhoneNumbers(
    wabaId: string,
    accessToken: string
  ): Promise<WhatsAppPhoneNumber[]> {
    const response = await fetchWithRetry(
      `${GRAPH_API_BASE}/${wabaId}/phone_numbers?fields=id,display_phone_number,verified_name,quality_rating,code_verification_status&access_token=${accessToken}`,
      { timeoutMs: 15000 }
    );

    if (!response.ok) {
      const body = await response.text();
      throw new Error(
        `Meta get phone_numbers failed: ${response.status} ${body}`
      );
    }

    const data = (await response.json()) as {
      data?: Array<{
        id: string;
        display_phone_number: string;
        verified_name: string;
        quality_rating: string;
        code_verification_status: string;
      }>;
    };

    return (data.data || []).map((phone) => ({
      id: phone.id,
      displayPhoneNumber: phone.display_phone_number,
      verifiedName: phone.verified_name,
      qualityRating: phone.quality_rating,
      codeVerificationStatus: phone.code_verification_status,
    }));
  }

  /**
   * Subscribe our app to webhook events on a WABA. Required after every
   * Embedded Signup finalize — Meta does not subscribe us automatically.
   */
  async subscribeToWebhooks(
    wabaId: string,
    accessToken: string
  ): Promise<boolean> {
    const response = await fetchWithRetry(
      `${GRAPH_API_BASE}/${wabaId}/subscribed_apps`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ access_token: accessToken }),
        timeoutMs: 15000,
      }
    );

    if (!response.ok) {
      const body = await response.text();
      logError(
        'whatsapp.oauth.subscribeToWebhooks',
        new Error(`Meta subscribeToWebhooks failed: ${response.status}`),
        {
          feature: 'integrations',
          extra: { wabaId, status: response.status, body },
        }
      );
      return false;
    }

    return true;
  }

  /**
   * Validate an access token via the debug_token endpoint.
   */
  async validateToken(
    accessToken: string
  ): Promise<{ isValid: boolean; expiresAt?: number; scopes?: string[] }> {
    try {
      const response = await fetchWithRetry(
        `${GRAPH_API_BASE}/debug_token?input_token=${accessToken}&access_token=${this.appId}|${this.appSecret}`,
        { timeoutMs: 15000 }
      );

      if (!response.ok) {
        return { isValid: false };
      }

      const data = (await response.json()) as {
        data?: {
          is_valid: boolean;
          expires_at?: number;
          scopes?: string[];
        };
      };
      const tokenData = data.data;

      return {
        isValid: tokenData?.is_valid ?? false,
        expiresAt: tokenData?.expires_at,
        scopes: tokenData?.scopes,
      };
    } catch {
      return { isValid: false };
    }
  }
}
