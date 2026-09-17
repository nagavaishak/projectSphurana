import { apiEnv } from '@borradh-workspace/env/api';
import { createLogger, logError } from '@borradh-workspace/observability';
import { handleMetaLeadWebhook } from '../../../lead-forms/index.js';
import {
  type DbConnection,
  ErrorCodes,
  FeatureError,
  type Result,
  err,
  ok,
} from '../../../shared/index.js';
import {
  type HandleFacebookLeadWebhookInput,
  handleFacebookLeadWebhookSchema,
} from './handle-facebook-lead-webhook.schema.js';

const logger = createLogger('FacebookLeadWebhook');

/** The body Meta receives back. `success` is part of the payload, not a Result flag. */
export interface FacebookLeadWebhookAck {
  success: true;
  processed: number;
  skipped: number;
}

/**
 * `POST /integrations/facebook/webhook` — the whole of it.
 *
 * Everything here used to sit in the handler body: the empty-payload guard, the
 * missing-app-secret guard, the call, the two log lines and the ack shape.
 *
 * SIGNATURE VERIFICATION STAYS WHERE IT WAS. `handleMetaLeadWebhook` verifies
 * `x-hub-signature-256` itself, against `META_APP_SECRET`, over the raw bytes.
 * It is deliberately NOT hoisted to the `MetaSignatureGuard` used by
 * `/webhooks/meta/*`: that guard is configured for a different route group, and
 * moving verification would change *what* is verified and *when* — the one
 * thing this port must not do.
 *
 * ERROR CODES ARE CHOSEN FOR THE STATUS THE ENTRY POINT MUST STILL RETURN.
 * The original handler mapped exactly two outcomes — `UNAUTHORIZED` → 401,
 * anything else → 400 — plus a hard-coded 500 for the missing secret. Since
 * `handleMetaLeadWebhook` can also surface `INTERNAL_ERROR` (via its
 * `trackedResult` wrapper), which previously still went out as 400, this
 * re-codes every non-`UNAUTHORIZED` failure to `VALIDATION_ERROR`. That keeps
 * the 401/400/500 split byte-identical while letting the entry point use a
 * plain three-way map instead of inventing its own.
 */
export const handleFacebookLeadWebhook = async (
  db: DbConnection,
  input: HandleFacebookLeadWebhookInput
): Promise<Result<FacebookLeadWebhookAck>> => {
  logger.info('Facebook webhook event received');

  const parsed = handleFacebookLeadWebhookSchema.safeParse(input);
  if (!parsed.success || !parsed.data.payload) {
    logger.warn('Empty webhook payload received');
    return err(new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Empty payload'));
  }

  const appSecret = apiEnv.META_APP_SECRET;
  if (!appSecret) {
    logError(
      'integrations.metaWebhookConfig',
      new Error('META_APP_SECRET not configured'),
      { feature: 'integrations' }
    );
    return err(
      new FeatureError(ErrorCodes.INTERNAL_ERROR, 'Webhook not configured')
    );
  }

  const result = await handleMetaLeadWebhook(
    db,
    {
      payload: parsed.data.payload,
      signature: parsed.data.signature as string,
    },
    appSecret
  );

  if (!result.success) {
    return err(
      new FeatureError(
        result.error.code === ErrorCodes.UNAUTHORIZED
          ? ErrorCodes.UNAUTHORIZED
          : ErrorCodes.VALIDATION_ERROR,
        result.error.message
      )
    );
  }

  logger.info(
    `Facebook webhook processed: ${result.data.processedLeads.length} leads created, ${result.data.skippedCount} skipped`
  );

  return ok({
    success: true,
    processed: result.data.processedLeads.length,
    skipped: result.data.skippedCount,
  });
};

export type HandleFacebookLeadWebhookResult = Awaited<
  ReturnType<typeof handleFacebookLeadWebhook>
>;
