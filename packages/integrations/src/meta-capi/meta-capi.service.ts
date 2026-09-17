/**
 * Meta Conversions API client — `POST /{pixel_id}/events`.
 *
 * CAPI IS THE SOURCE OF TRUTH, not a backup for the browser pixel. iOS (ITP +
 * ATT) kills most browser events before they leave the device, so every
 * conversion here must be sendable with no browser involvement at all: the
 * `fbc`/`fbp` cookies and the browser event are ENRICHMENT, and their absence
 * degrades match quality rather than dropping the event.
 *
 * The browser half of the pair lives in `apps/marketing-astro`. The contract
 * between the two halves is `event_id` — see `event-id.ts` in
 * `packages/features/src/microsites/pixel`.
 */

import { createHmac } from 'node:crypto';
import { fetchWithRetry } from '@borradh-workspace/http';
import { GRAPH_API_BASE } from '../shared/graph-api.js';
import { parseMetaErrorResponse } from '../shared/meta-api-error.js';
import { hasMatchKey, hashUserData } from './hash-user-data.js';
import type {
  MetaCapiCredentials,
  MetaCapiEvent,
  MetaCapiEventInput,
  MetaCapiSendResult,
} from './meta-capi.types.js';

/** Meta rejects events older than this; sending them wastes a round trip. */
export const CAPI_MAX_EVENT_AGE_SECONDS = 7 * 24 * 60 * 60;

export class MetaCapiService {
  private readonly accessToken: string;
  private readonly pixelId: string;
  private readonly appSecret?: string;
  private readonly testEventCode?: string;

  constructor(credentials: MetaCapiCredentials) {
    this.accessToken = credentials.accessToken;
    this.pixelId = credentials.pixelId;
    this.appSecret = credentials.appSecret;
    this.testEventCode = credentials.testEventCode;
  }

  /**
   * Hash the identifying fields and POST the batch.
   *
   * Throws `MetaApiError` on a non-2xx response — the CALLER decides what a
   * Meta outage means. For a customer booking the answer is always "nothing":
   * see `send-conversion-event` in the features package, which swallows this.
   */
  async sendEvents(inputs: MetaCapiEventInput[]): Promise<MetaCapiSendResult> {
    const events: MetaCapiEvent[] = inputs.map((input) => {
      const { user_data, action_source, ...rest } = input;
      return {
        ...rest,
        action_source: action_source ?? 'website',
        user_data: hashUserData(user_data),
      };
    });

    const url = `${GRAPH_API_BASE}/${this.pixelId}/events`;
    const body: Record<string, unknown> = {
      data: events,
      access_token: this.accessToken,
    };
    if (this.testEventCode) body.test_event_code = this.testEventCode;
    if (this.appSecret) {
      body.appsecret_proof = createHmac('sha256', this.appSecret)
        .update(this.accessToken)
        .digest('hex');
    }

    const response = await fetchWithRetry(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      throw await parseMetaErrorResponse(
        response,
        'Failed to send Conversions API events'
      );
    }

    const json = (await response.json()) as {
      events_received?: number;
      fbtrace_id?: string;
      messages?: string[];
    };

    return {
      eventsReceived: json.events_received ?? 0,
      fbtraceId: json.fbtrace_id,
      messages: json.messages,
    };
  }
}

/** True when the event still falls inside Meta's 7-day acceptance window. */
export const isWithinCapiWindow = (
  eventTimeSeconds: number,
  nowSeconds: number = Math.floor(Date.now() / 1000)
): boolean => nowSeconds - eventTimeSeconds <= CAPI_MAX_EVENT_AGE_SECONDS;

export { hashUserData, hasMatchKey };
