/**
 * Pixel (a.k.a. Dataset) management on an ad account.
 *
 * ENDPOINT NAMING, so nobody goes hunting: Meta renamed Pixels to "Datasets"
 * in the Events Manager UI, but the Graph API object and edge are unchanged —
 * `GET/POST /act_{ad_account_id}/adspixels`. There is no `/datasets` endpoint.
 *
 * These calls run against the CUSTOMER's ad account with the customer's token.
 * A Borradh-owned pixel shared inward would mean the org cannot take its own
 * conversion history with it when it leaves — their account, their asset, we
 * only operate it.
 */

import { createHmac } from 'node:crypto';
import { fetchWithRetry } from '@borradh-workspace/http';
import { GRAPH_API_BASE } from '../shared/graph-api.js';
import { parseMetaErrorResponse } from '../shared/meta-api-error.js';

export interface MetaPixelsCredentials {
  accessToken: string;
  /** With or without the `act_` prefix. */
  adAccountId: string;
  appSecret?: string;
}

export interface MetaAdsPixel {
  id: string;
  name?: string;
}

export class MetaPixelsService {
  private readonly accessToken: string;
  private readonly adAccountId: string;
  private readonly appSecret?: string;

  constructor(credentials: MetaPixelsCredentials) {
    this.accessToken = credentials.accessToken;
    this.appSecret = credentials.appSecret;
    this.adAccountId = credentials.adAccountId.startsWith('act_')
      ? credentials.adAccountId
      : `act_${credentials.adAccountId}`;
  }

  private authParams(): string {
    const params = new URLSearchParams({ access_token: this.accessToken });
    if (this.appSecret) {
      params.set(
        'appsecret_proof',
        createHmac('sha256', this.appSecret)
          .update(this.accessToken)
          .digest('hex')
      );
    }
    return params.toString();
  }

  /** Every pixel already on the ad account. Empty is the only "create" case. */
  async listPixels(): Promise<MetaAdsPixel[]> {
    const url = `${GRAPH_API_BASE}/${this.adAccountId}/adspixels?fields=id,name&${this.authParams()}`;
    const response = await fetchWithRetry(url, { method: 'GET' });

    if (!response.ok) {
      throw await parseMetaErrorResponse(response, 'Failed to list ads pixels');
    }

    const json = (await response.json()) as { data?: MetaAdsPixel[] };
    return json.data ?? [];
  }

  /**
   * Create a pixel on the ad account.
   *
   * Ad accounts are CAPPED on pixel creation, so this is the rare branch —
   * call it only after {@link listPixels} came back empty.
   */
  async createPixel(name: string): Promise<MetaAdsPixel> {
    const url = `${GRAPH_API_BASE}/${this.adAccountId}/adspixels`;
    const response = await fetchWithRetry(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `name=${encodeURIComponent(name)}&${this.authParams()}`,
    });

    if (!response.ok) {
      throw await parseMetaErrorResponse(
        response,
        'Failed to create ads pixel'
      );
    }

    const json = (await response.json()) as MetaAdsPixel;
    return { id: json.id, name: json.name ?? name };
  }
}
