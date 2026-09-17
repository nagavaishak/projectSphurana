import { apiEnv } from '@borradh-workspace/env/api';
import { handleMetaDeletionCallback } from '@borradh-workspace/features/integrations';
import {
  type WebhookProvider,
  classifyMetaMessagingEvent,
  dispositionOf,
  metaChangeSchema,
  metaMessagingEventSchema,
} from '@borradh-workspace/integrations/webhooks';
import { logError } from '@borradh-workspace/observability';
import { HttpException, HttpStatus, type Logger } from '@nestjs/common';
import { webhookHttpError } from '../webhook-http-error.js';
import {
  type MetaChangesContext,
  type MetaPlatform,
  WebhookHandlerError,
  metaHandlersFor,
} from './meta-webhook-handlers.js';

/**
 * The ORCHESTRATION side of the Meta webhooks — everything the controller used
 * to do after `MetaSignatureGuard` had authenticated the request.
 *
 * Signature verification is NOT here (it is a guard). What is here is envelope
 * parsing, leadgen-vs-messaging routing, registry dispatch and the ack shape.
 * Kept beside `meta-webhook-handlers.ts` rather than pushed into
 * `packages/features` because the handler map it dispatches into already lives
 * here and is typed against Nest's `Logger`; splitting the two halves across a
 * package boundary would buy nothing and cost the compile-checked
 * "subscribed ⇔ handled" invariant that map enforces.
 */

export interface MetaWebhookAck {
  success: true;
  processedCount: number;
}

const providerFor = (platform: MetaPlatform): WebhookProvider =>
  platform === 'instagram_dm' ? 'instagram' : 'meta_page';

/**
 * Leadgen endpoint: Meta delivers EVERY subscribed field to this one callback
 * URL. Dispatch each `changes[].field` through the webhook registry — a handled
 * field runs its handler, an `ignoredBecause` field is dropped WITH ITS WRITTEN
 * REASON in the log, and a field the registry has never heard of is an ERROR,
 * not a silent 200.
 */
export async function dispatchMetaLeadgenWebhook(input: {
  rawBody: string;
  signature: string;
  appSecret: string;
  logger: Logger;
}): Promise<MetaWebhookAck> {
  const { rawBody, signature, appSecret, logger } = input;

  const payload = JSON.parse(rawBody) as { object: string; entry?: unknown };

  // Log full raw payload for debugging referral issues
  logger.log(`Raw leadgen webhook payload: ${rawBody.substring(0, 2000)}`);

  if (!Array.isArray(payload.entry)) {
    logger.log('Leadgen webhook payload missing entry array, acknowledging');
    return { success: true, processedCount: 0 };
  }

  const hasMessaging = payload.entry.some(
    (e: unknown) => !!(e as { messaging?: unknown }).messaging
  );

  if (hasMessaging) {
    logger.log('Routing messaging event to messaging handler');
    return dispatchMetaMessagingWebhook({ rawBody, logger });
  }

  const fields = [
    ...new Set(
      payload.entry
        .flatMap((e: unknown) => (e as { changes?: unknown[] }).changes ?? [])
        .map((c) => metaChangeSchema.safeParse(c))
        .flatMap((r) => (r.success ? [r.data.field] : []))
    ),
  ];

  const handlers = metaHandlersFor('facebook_messenger');
  const ctx: MetaChangesContext = { rawBody, signature, appSecret, logger };

  let processedCount = 0;
  for (const field of fields) {
    const disposition = dispositionOf('meta_page', field);

    if (disposition.kind === 'ignored') {
      logger.log(
        `Dropping meta_page.${field} — declared ignoredBecause: ${disposition.because}`
      );
      continue;
    }

    if (disposition.kind === 'undeclared') {
      logError(
        'meta.webhook.undeclaredEvent',
        new Error(
          `Meta delivered an undeclared webhook field "${field}". Add it to the webhook registry with a handler or an ignoredBecause reason.`
        ),
        { feature: 'webhooks', extra: { provider: 'meta_page', field } }
      );
      continue;
    }

    if (disposition.kind === 'deliveredAs') {
      // A `deliveredAs` field (today only `message_echoes`) is a MESSAGING
      // field: real traffic arrives in `entry[].messaging[]` and is handled
      // above, before this loop. It reaches the changes path only from Meta's
      // own webhook test tool, which ships a synthetic `changes` entry — and
      // that used to surface as a scary handlerMismatch error while the
      // integration was in fact fine. Log it for what it is.
      logger.log(
        `meta_page.${field} arrived on the changes path; real events are delivered as ${disposition.as} under entry[].messaging — this is Meta's synthetic test payload, not a fault`
      );
      continue;
    }

    const handler = handlers[field];
    if (!handler || handler.delivery !== 'changes') {
      // Unreachable: the registry declares `changes` delivery for every
      // handled field on this path, and the handler map is exhaustive over
      // the registry's handled types.
      logError(
        'meta.webhook.handlerMismatch',
        new Error(`No changes-handler bound for meta_page.${field}`),
        { feature: 'webhooks', extra: { field } }
      );
      continue;
    }

    try {
      processedCount += await handler.run(ctx);
    } catch (error) {
      if (error instanceof WebhookHandlerError) {
        throw webhookHttpError(error);
      }
      throw error;
    }
  }

  return { success: true, processedCount };
}

/**
 * Messaging endpoint: which subscription field produced an event is INFERRED
 * from the event's shape (see `classifyMetaMessagingEvent`) — Meta does not
 * label them — so dispatch and the subscribed_fields list speak the same
 * vocabulary.
 */
export async function dispatchMetaMessagingWebhook(input: {
  rawBody: string;
  logger: Logger;
}): Promise<MetaWebhookAck> {
  const { rawBody, logger } = input;

  const payload = JSON.parse(rawBody) as {
    object: string;
    entry?: Array<{ messaging?: unknown[] }>;
  };

  if (!Array.isArray(payload.entry)) {
    logger.log('Messaging webhook payload missing entry array, acknowledging');
    return { success: true, processedCount: 0 };
  }

  // Determine platform from the webhook object field
  const platform: MetaPlatform =
    payload.object === 'instagram' ? 'instagram_dm' : 'facebook_messenger';
  const provider = providerFor(platform);
  const handlers = metaHandlersFor(platform);

  logger.log(
    `Processing ${platform} messaging webhook, entries: ${payload.entry.length}`
  );

  let processedCount = 0;

  for (const entry of payload.entry) {
    for (const raw of entry.messaging ?? []) {
      const parsed = metaMessagingEventSchema.safeParse(raw);
      if (!parsed.success) {
        logError(
          'meta.webhook.unparseableMessagingEvent',
          new Error('Messaging event did not match the registry payload shape'),
          {
            feature: 'webhooks',
            extra: { provider, issues: parsed.error.issues },
          }
        );
        continue;
      }
      const event = parsed.data;

      const type = classifyMetaMessagingEvent(event, platform);
      if (!type) {
        logError(
          'meta.webhook.unclassifiableMessagingEvent',
          new Error(
            'Messaging event carries none of the keys that identify a subscription field'
          ),
          { feature: 'webhooks', extra: { provider, keys: Object.keys(event) } }
        );
        continue;
      }

      const disposition = dispositionOf(provider, type);

      if (disposition.kind === 'ignored') {
        logger.debug(
          `Dropping ${provider}.${type} — declared ignoredBecause: ${disposition.because}`
        );
        continue;
      }

      if (disposition.kind === 'undeclared') {
        logError(
          'meta.webhook.undeclaredEvent',
          new Error(
            `Meta delivered an undeclared webhook event "${type}". Add it to the webhook registry with a handler or an ignoredBecause reason.`
          ),
          { feature: 'webhooks', extra: { provider, type } }
        );
        continue;
      }

      const handler = handlers[type];
      if (!handler || handler.delivery !== 'messaging') {
        logError(
          'meta.webhook.handlerMismatch',
          new Error(`No messaging-handler bound for ${provider}.${type}`),
          { feature: 'webhooks', extra: { provider, type } }
        );
        continue;
      }

      processedCount += await handler.run({ event, platform, logger });
    }
  }

  logger.log(`Messaging webhook done: ${processedCount} processed`);
  return { success: true, processedCount };
}

/**
 * Data-deletion callback. Meta expects the exact `{ url, confirmation_code }`
 * response shape below.
 */
export async function dispatchMetaDataDeletion(input: {
  signedRequest: string;
  logger: Logger;
}): Promise<{ url: string; confirmation_code: string }> {
  const { signedRequest, logger } = input;

  if (!signedRequest) {
    throw new HttpException('Missing signed_request', HttpStatus.BAD_REQUEST);
  }

  const appSecret = apiEnv.META_APP_SECRET;
  if (!appSecret) {
    logError(
      'meta.webhookConfig',
      new Error('META_APP_SECRET not configured'),
      {
        feature: 'webhooks',
      }
    );
    throw new HttpException(
      'Webhook not configured',
      HttpStatus.INTERNAL_SERVER_ERROR
    );
  }

  const webUrl = apiEnv.WEB_URL ?? 'https://borradh.io';

  const result = await handleMetaDeletionCallback({
    signedRequest,
    appSecret,
    dataDeletionUrl: `${webUrl}/data-deletion`,
  });

  if (!result.success) {
    throw webhookHttpError(result.error);
  }

  logger.log(
    `Data deletion callback processed, confirmation: ${result.data.confirmationCode}`
  );

  return {
    url: result.data.url,
    confirmation_code: result.data.confirmationCode,
  };
}
