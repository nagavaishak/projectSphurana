import { db, withSystemScope } from '@borradh-workspace/database';
import { apiEnv } from '@borradh-workspace/env/api';
import {
  handleIncomingMessage,
  handleStandaloneReferral,
  recordEchoMessage,
} from '@borradh-workspace/features/conversations';
import { handleMetaLeadWebhook } from '@borradh-workspace/features/lead-forms';
import type {
  HandledTypeOf,
  MetaMessagingEvent,
} from '@borradh-workspace/integrations/webhooks';
import type {
  instagramEvents,
  metaPageEvents,
} from '@borradh-workspace/integrations/webhooks';
import type { Logger } from '@nestjs/common';

/**
 * The handler side of the webhook registry.
 *
 * The maps below are typed `Record<HandledTypeOf<…>, MetaHandler>` — the key
 * set is DERIVED from the registry, so:
 *
 *   - declaring an event `handled()` without binding a handler here is a
 *     COMPILE error (missing property), and
 *   - binding a handler for an event the registry does not declare `handled()`
 *     is a COMPILE error (excess property).
 *
 * That is the "subscribed ⇔ handled" invariant, enforced by the type checker
 * rather than by a hand-written list that can silently omit `feed`.
 */

export type MetaPlatform = 'facebook_messenger' | 'instagram_dm';

export interface MetaMessagingContext {
  /** One element of `entry[].messaging[]`. */
  event: MetaMessagingEvent;
  platform: MetaPlatform;
  logger: Logger;
}

export interface MetaChangesContext {
  /** The verified raw body — the leadgen service re-verifies and parses it. */
  rawBody: string;
  signature: string;
  appSecret: string;
  logger: Logger;
}

/** Number of events this handler actually processed. */
export type MetaMessagingHandler = (
  ctx: MetaMessagingContext
) => Promise<number>;
export type MetaChangesHandler = (ctx: MetaChangesContext) => Promise<number>;

export type MetaHandler =
  | { readonly delivery: 'messaging'; readonly run: MetaMessagingHandler }
  | { readonly delivery: 'changes'; readonly run: MetaChangesHandler };

// ---------------------------------------------------------------- handlers

/**
 * A feature-level failure raised from inside a handler. The controller catches
 * it and runs it through its existing error→status mapper — deliberately NOT a
 * new copy of that mapper here.
 */
export class WebhookHandlerError extends Error {
  constructor(
    readonly code: string,
    message: string
  ) {
    super(message);
    this.name = 'WebhookHandlerError';
  }
}

const handleLeadgen: MetaChangesHandler = async ({
  rawBody,
  signature,
  appSecret,
  logger,
}) => {
  const result = await withSystemScope(
    (conn) =>
      handleMetaLeadWebhook(conn, { payload: rawBody, signature }, appSecret),
    { db }
  );

  if (!result.success) {
    throw new WebhookHandlerError(result.error.code, result.error.message);
  }

  logger.log(
    `Leadgen processed: ${result.data.processedLeads.length} leads created, ${result.data.skippedCount} skipped`
  );
  return result.data.processedLeads.length;
};

/**
 * Inbound message OR a page echo. A message that carries a referral (new thread
 * opened from a click-to-message ad) arrives here too — the referral rides
 * inside `message.referral`.
 */
const handleMessages: MetaMessagingHandler = async ({
  event,
  platform,
  logger,
}) => {
  const message = event.message;
  if (!message) return 0;

  if (message.is_echo) {
    // Maximum echo observability: capture the discriminating origin signals so
    // "what was this echo?" is answerable from logs instead of guesswork.
    // app_id present & == ours → our own bot/agent send; app_id absent → Page
    // inbox (human) OR page-native automation (IG Instant Reply / auto-responder).
    const appId = message.app_id != null ? String(message.app_id) : undefined;
    const isOwnAppEcho =
      !!appId && !!apiEnv.META_APP_ID && appId === apiEnv.META_APP_ID;
    // `type` is optional at the ingress (Meta ships attachments without one) —
    // this list is diagnostic, so name the gap rather than drop the attachment.
    const attachmentTypes = (message.attachments ?? []).map(
      (a) => a.type ?? 'unknown'
    );
    const echoText = message.text ?? '';
    logger.log(
      `echo.received: page=${event.sender.id} user=${event.recipient.id} platform=${platform} ` +
        `appId=${appId ?? 'none'} isOwnApp=${isOwnAppEcho} ` +
        `contentLength=${echoText.length} isEmpty=${echoText.trim().length === 0} ` +
        `attachments=[${attachmentTypes.join(',')}] hasMetadata=${message.metadata != null} ` +
        `hasQuickReply=${!!message.quick_reply} mid=${message.mid}`
    );
    // An echo with no mid cannot be recorded (recordEchoMessage keys on
    // externalMessageId). Anomalous in practice; log and move on rather than
    // throw — an unrecordable echo of our OWN outbound must never 500 the
    // webhook and make Meta retry the whole batch.
    // Hoisted: narrowing a property does not survive into the closure below.
    const echoMid = message.mid;
    if (!echoMid) {
      logger.warn(
        `echo.skipped: no mid — page=${event.sender.id} user=${event.recipient.id} platform=${platform}`
      );
      return 0;
    }
    await withSystemScope(
      (conn) =>
        recordEchoMessage(conn, {
          pageId: event.sender.id,
          externalUserId: event.recipient.id,
          externalMessageId: echoMid,
          messageText: message.text,
          platform,
          timestamp: event.timestamp,
          ...(appId ? { appId } : {}),
          isOwnAppEcho,
          attachmentTypes,
          hasAppMetadata: message.metadata != null,
        }),
      { db }
    );
    // Echoes are recorded, not "processed" — they are our own outbound.
    return 0;
  }

  logger.log(
    `Processing message ${message.mid} from sender=${event.sender.id} to page=${event.recipient.id}`
  );

  // Ad referral data (click-to-message ads): event-level (existing thread) or
  // message-level (new thread from a CTM ad).
  const referral = event.referral ?? message.referral;

  const result = await withSystemScope(
    (conn) =>
      handleIncomingMessage(conn, {
        pageId: event.recipient.id,
        senderId: event.sender.id,
        messageId: message.mid,
        messageText: message.text,
        // Forward stickers/photos/files so they don't store blank.
        ...(message.attachments?.length
          ? { attachments: message.attachments }
          : {}),
        platform,
        timestamp: event.timestamp,
        ...(referral?.ad_id
          ? {
              adReferral: {
                metaAdId: referral.ad_id,
                source: referral.source,
                adTitle: referral.ads_context_data?.ad_title,
                adPhotoUrl: referral.ads_context_data?.photo_url,
                adVideoUrl: referral.ads_context_data?.video_url,
              },
            }
          : {}),
      }),
    { db }
  );

  if (!result.success) {
    logger.warn(
      `Failed to process message ${message.mid}: [${result.error.code}] ${result.error.message}`
    );
    return 0;
  }

  logger.log(
    `Message processed: conversationId=${result.data.conversationId}, messageId=${result.data.messageId}`
  );
  return 1;
};

/**
 * Standalone referral: the user entered the thread via an ad click and has not
 * sent a message yet. Delivered by `messaging_referrals` (Page) /
 * `messaging_referral` (Instagram — Meta spells it singular there).
 */
const handleReferral: MetaMessagingHandler = async ({
  event,
  platform,
  logger,
}) => {
  const referral = event.referral;
  const adId = referral?.ad_id;
  if (!referral || !adId) return 0;

  logger.log(
    `Processing standalone referral from sender=${event.sender.id} to page=${event.recipient.id}, ad_id=${adId}`
  );

  await withSystemScope(
    (conn) =>
      handleStandaloneReferral(conn, {
        pageId: event.recipient.id,
        senderId: event.sender.id,
        platform,
        adReferral: {
          metaAdId: adId,
          source: referral.source,
          adTitle: referral.ads_context_data?.ad_title,
          adPhotoUrl: referral.ads_context_data?.photo_url,
          adVideoUrl: referral.ads_context_data?.video_url,
        },
      }),
    { db }
  );
  return 1;
};

// ------------------------------------------------------------- handler maps

export const metaPageHandlers: Record<
  HandledTypeOf<(typeof metaPageEvents)[number]>,
  MetaHandler
> = {
  leadgen: { delivery: 'changes', run: handleLeadgen },
  messages: { delivery: 'messaging', run: handleMessages },
  messaging_referrals: { delivery: 'messaging', run: handleReferral },
};

export const instagramHandlers: Record<
  HandledTypeOf<(typeof instagramEvents)[number]>,
  MetaHandler
> = {
  messages: { delivery: 'messaging', run: handleMessages },
  messaging_referral: { delivery: 'messaging', run: handleReferral },
};

export const metaHandlersFor = (
  platform: MetaPlatform
): Record<string, MetaHandler> =>
  platform === 'instagram_dm' ? instagramHandlers : metaPageHandlers;
