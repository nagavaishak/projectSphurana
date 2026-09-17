import { withSystemScope } from '@borradh-workspace/database';
import { logError } from '@borradh-workspace/observability';
import type { DbConnection } from '../../../shared/index.js';
import {
  type MetaWebhookPayload,
  handleWebhook,
} from '../handle-webhook/index.js';

export interface AcknowledgeMetaAdsWebhookInput {
  payload: MetaWebhookPayload;
  /** `x-hub-signature-256`, absent when the caller is not Meta. */
  signature: string | undefined;
  /** RAW request bytes as a string — Meta signs bytes, not the parsed object. */
  rawBody: string;
  /** `META_APP_SECRET`; undefined when the deployment is misconfigured. */
  appSecret: string | undefined;
}

/**
 * What the webhook endpoint should reply, decided entirely here so the route is
 * only `call the use case, write it`.
 *
 * Two body FORMS, both load-bearing and pinned by
 * `apps/api/src/_integration/meta-ads-controller.int-spec.ts`:
 *  - `text` — sent with `res.send()`, i.e. a bare string body. The missing-
 *    signature case must stay `400` with the literal body `Missing signature`,
 *    NOT a JSON error envelope.
 *  - `body` — sent with `res.json()`.
 */
export type MetaAdsWebhookAck =
  | { status: number; text: string }
  | { status: number; body: Record<string, unknown> };

/**
 * Verify and process a Meta ads webhook delivery, returning the acknowledgement
 * to send back.
 *
 * This was the body of `POST /meta-ads/webhook`. NOTE it does NOT reuse
 * `MetaSignatureGuard`: that guard answers `403 Missing signature` / `400 Empty
 * payload`, whereas this endpoint's long-standing contract is `400 Missing
 * signature`, and Meta's retry behaviour keys off the status. The HMAC check
 * itself lives inside `handleWebhook`.
 *
 * Never throws — a webhook endpoint that 500s unexpectedly triggers Meta's retry
 * backoff and eventual unsubscription.
 */
export const acknowledgeMetaAdsWebhook = async (
  db: DbConnection,
  input: AcknowledgeMetaAdsWebhookInput
): Promise<MetaAdsWebhookAck> => {
  if (!input.signature) {
    return { status: 400, text: 'Missing signature' };
  }

  if (!input.appSecret) {
    logError(
      'metaAds.webhookHandler',
      new Error('META_APP_SECRET not configured'),
      { feature: 'metaAds' }
    );
    return { status: 500, text: 'App secret not configured' };
  }

  const appSecret = input.appSecret;
  const result = await withSystemScope(
    (conn) =>
      handleWebhook(
        conn,
        {
          payload: input.payload,
          signature: input.signature as string,
          rawBody: input.rawBody,
        },
        appSecret
      ),
    { db }
  );

  if (!result.success) {
    return { status: 400, body: { error: result.error.message } };
  }

  return {
    status: 200,
    body: {
      received: true,
      processed: result.data.processed,
      synced: result.data.synced,
    },
  };
};
