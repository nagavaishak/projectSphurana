import { db, withSystemScope } from '@borradh-workspace/database';
import { apiEnv } from '@borradh-workspace/env/api';
import { handleClaireWhatsappInbound } from '@borradh-workspace/features/assistant';
import { updateWhatsappTemplateStatus } from '@borradh-workspace/features/campaigns';
import {
  handleIncomingMessage,
  ingestHistoricalMessage,
  markWhatsappHistoryComplete,
  recordEchoMessage,
  updateMessageStatus,
} from '@borradh-workspace/features/conversations';
import { dispositionOf } from '@borradh-workspace/integrations/webhooks';
import { logError } from '@borradh-workspace/observability';
import { HttpException, HttpStatus, type Logger } from '@nestjs/common';

/**
 * The ORCHESTRATION side of the WhatsApp Cloud webhook — everything the
 * controller used to do after `WhatsAppSignatureGuard` had authenticated the
 * request.
 *
 * Signature verification is NOT here (it is a guard). What is here is the Meta
 * envelope walk (`entry[] → changes[] → value.messages[] / statuses[] /
 * message_echoes[] / history[]`), registry disposition, per-field dispatch and
 * the ack shape. Kept beside the controller — rather than pushed into
 * `packages/features` — for the same reason `meta-webhook-dispatch.ts` is:
 * it is transport-envelope shredding typed against Nest's `Logger`, and the
 * per-message BUSINESS pipelines it dispatches into already live in
 * `packages/features` (`handleClaireWhatsappInbound`, `handleIncomingMessage`,
 * `recordEchoMessage`, `ingestHistoricalMessage`, `updateMessageStatus`).
 *
 * ACK CONTRACT (load-bearing): every per-item failure is logged and counted
 * out, never thrown. Meta retries with exponential backoff on any non-2xx,
 * which redelivers — and therefore DUPLICATES — real customer messages. The
 * only non-2xx this function can produce is the 400 on unparseable JSON, which
 * is exactly what the controller did before.
 */

export interface WhatsAppWebhookAck {
  success: true;
  processedCount: number;
}

// Parse the WhatsApp Cloud API payload.
// Fields we handle:
//   - `messages`            inbound user messages + delivery statuses
//   - `smb_message_echoes`  outbound messages from the native WA Business
//                           app under Coexistence (agent takeover signal)
//   - `history`             6-month backfill replayed during Coexistence
//                           onboarding — populates the local DB so prior
//                           chats show in the inbox and give Claire context
type WaMessage = {
  from: string;
  id: string;
  timestamp: string;
  type: string;
  text?: { body: string };
  // Interactive reply (list_reply from interactive list, button_reply from
  // quick-reply buttons). Sent when user taps a row in a WhatsApp
  // interactive list message (e.g. clip selection carousel).
  interactive?: {
    type: string;
    list_reply?: { id: string; title: string; description?: string };
    button_reply?: { id: string; title: string };
  };
  // Click-to-WhatsApp (CTWA) attribution. Meta's WhatsApp Cloud API
  // attaches a `referral` object to the FIRST inbound message of a
  // conversation that started from a click-to-WhatsApp ad. `source_id`
  // is the Meta ad id (mirrors Messenger's `referral.ad_id`); `headline`
  // is the ad's headline. `source_type` is 'ad' for CTWA. See PRD-1 Task 1.
  referral?: {
    source_url?: string;
    source_id?: string;
    source_type?: string;
    headline?: string;
    body?: string;
    media_type?: string;
    ctwa_clid?: string;
  };
};
type WaEcho = {
  from: string;
  to: string;
  id: string;
  timestamp: string;
  type: string;
  text?: { body: string };
};
type WaHistoryThread = {
  id: string; // contact wa_id
  messages?: WaEcho[];
};
type WaHistoryEntry = {
  metadata?: { phase?: number; chunk_order?: number; progress?: number };
  threads?: WaHistoryThread[];
  errors?: Array<{ code: number; title?: string }>;
};

type WaChangeValue = {
  messaging_product?: string;
  metadata?: {
    phone_number_id: string;
    display_phone_number: string;
  };
  contacts?: Array<{
    profile: { name: string };
    wa_id: string;
  }>;
  messages?: WaMessage[];
  statuses?: Array<{
    id: string;
    status: string;
    recipient_id: string;
    timestamp: string;
    // Present on `failed` statuses — Meta's reason the message wasn't
    // delivered (e.g. 131052 media download error, 131047 re-engagement
    // / outside 24h window).
    errors?: Array<{
      code?: number;
      title?: string;
      message?: string;
      error_data?: { details?: string };
    }>;
  }>;
  message_echoes?: WaEcho[];
  history?: WaHistoryEntry[];
  // `message_template_status_update` field — WABA-scoped (no metadata/
  // phone_number_id). Meta pushes template approval lifecycle transitions here.
  event?: string;
  message_template_id?: number | string;
  message_template_name?: string;
  message_template_language?: string;
  reason?: string | null;
};

type WaPayload = {
  object: string;
  entry: Array<{
    id: string;
    changes: Array<{
      field: string;
      value: WaChangeValue;
    }>;
  }>;
};

/**
 * `messages` field: inbound user messages (Claire branch first, then the
 * receptionist) plus delivery-status updates.
 */
async function dispatchMessagesChange(
  value: WaChangeValue,
  phoneNumberId: string,
  logger: Logger
): Promise<number> {
  let processedCount = 0;

  // Extract sender name from contacts array
  const contactName = value.contacts?.[0]?.profile?.name;

  // Visibility line for EVERY inbound messages change: which WA number
  // (phone_number_id) Meta delivered to, whether it's the dedicated
  // Claire number, and how many messages/statuses. This is the single
  // most useful diagnostic for "did my WhatsApp message reach us and
  // on which number" — without it, inbound routing is a black box.
  if (value.messages?.length) {
    const isClaireNumber =
      apiEnv.CLAIRE_WHATSAPP_ENABLED &&
      apiEnv.CLAIRE_WHATSAPP_PHONE_NUMBER_ID === phoneNumberId;
    logger.log(
      `WhatsApp inbound messages ${JSON.stringify({
        phoneNumberId,
        displayPhoneNumber: value.metadata?.display_phone_number,
        isClaireNumber,
        messageCount: value.messages.length,
        types: value.messages.map((m) => m.type),
      })}`
    );
  }

  // Process incoming messages
  if (value.messages) {
    for (const msg of value.messages) {
      // Claire-on-WhatsApp branch (WS-10). On the DEDICATED Claire
      // number (and only when the flag is on) this verifies pairing
      // codes or enqueues an owner Claire turn, then returns early so
      // we DON'T fall through to the receptionist. On any other
      // number — or with the flag off — `handled` is false and the
      // receptionist path below runs exactly as before.
      // NOTE: checked BEFORE the text-only filter so Claire can reply
      // to non-text messages (images, voice notes) with a helpful nudge.
      //
      // Normalize interactive replies (list_reply from clip carousel,
      // button_reply) to text so Claire handles them transparently.
      let effectiveText = msg.text?.body ?? null;
      let effectiveType = msg.type;
      if (msg.type === 'interactive' && msg.interactive) {
        const lr = msg.interactive.list_reply;
        const br = msg.interactive.button_reply;
        if (lr) {
          effectiveText = `I picked: ${lr.title} (${lr.id})`;
          effectiveType = 'text';
        } else if (br) {
          effectiveText = br.title ?? br.id;
          effectiveType = 'text';
        }
      }

      let handled = false;
      try {
        handled = await handleClaireWhatsappInbound(
          db,
          {
            phoneNumberId,
            fromPhoneE164: msg.from,
            messageText: effectiveText,
            messageType: effectiveType,
            inboundMessageId: msg.id,
          },
          logger
        );
      } catch (claireError) {
        logError('whatsapp.claire.inbound', claireError, {
          feature: 'assistant',
        });
        // A Claire-branch failure must not poison the receptionist
        // path on the other number; but if this WAS the Claire number
        // we still don't want to route an owner message to the
        // receptionist. Treat a thrown Claire branch as handled only
        // when it's the Claire number.
        handled =
          apiEnv.CLAIRE_WHATSAPP_ENABLED &&
          apiEnv.CLAIRE_WHATSAPP_PHONE_NUMBER_ID === phoneNumberId;
      }
      if (handled) {
        processedCount++;
        continue;
      }

      // Receptionist path: text messages only (non-text on the
      // receptionist number is ignored — the Claire branch above
      // already handles non-text on the dedicated number).
      if (msg.type !== 'text' || !msg.text?.body) continue;

      // Click-to-WhatsApp attribution (PRD-1 Task 1). When this is
      // the first message of a CTWA conversation, Meta attaches a
      // `referral` object whose `source_id` is the ad id. Pass it
      // through so `handleIncomingMessage` → `resolveAdReferral`
      // stores `adMetaId`/`adInternalId` on `conversation.metadata`,
      // mirroring the Messenger handler. The referral only arrives
      // on the opening message, so later messages carry no `referral`
      // and skip this branch (the metadata is already persisted).
      const adReferral =
        msg.referral?.source_id != null
          ? {
              metaAdId: msg.referral.source_id,
              source: msg.referral.source_type,
              adTitle: msg.referral.headline,
            }
          : undefined;

      const result = await withSystemScope(
        (conn) =>
          handleIncomingMessage(conn, {
            pageId: phoneNumberId,
            senderId: msg.from,
            senderName: contactName,
            messageId: msg.id,
            messageText: msg.text?.body ?? '',
            platform: 'whatsapp',
            timestamp: Number.parseInt(msg.timestamp, 10) * 1000,
            ...(adReferral ? { adReferral } : {}),
          }),
        { db }
      );

      if (!result.success) {
        logger.warn(
          `Failed to process WhatsApp message ${msg.id}: ${result.error.message}`
        );
      } else {
        processedCount++;
      }
    }
  }

  // Process message status updates (sent, delivered, read)
  if (value.statuses) {
    for (const status of value.statuses) {
      // Surface delivery failures — Meta accepts a media send with
      // 200 + messageId, then reports an async `failed` status here if
      // it can't fetch/deliver the media (size, codec, unreachable
      // URL, or an out-of-window re-engagement block). Previously these
      // were silently dropped, leaving "sent but never arrived" with
      // no trace.
      if (status.status === 'failed') {
        logger.warn(
          `WhatsApp delivery failed for message ${status.id}: ${
            status.errors
              ?.map((e) =>
                `[${e.code}] ${e.title ?? ''} ${
                  e.error_data?.details ?? e.message ?? ''
                }`.trim()
              )
              .join('; ') || 'no error detail'
          } (recipient ${status.recipient_id})`
        );
        continue;
      }

      if (!['sent', 'delivered', 'read'].includes(status.status)) continue;

      const result = await withSystemScope(
        (conn) =>
          updateMessageStatus(conn, {
            externalMessageId: status.id,
            status: status.status as 'sent' | 'delivered' | 'read',
            timestamp: Number.parseInt(status.timestamp, 10) * 1000,
          }),
        { db }
      );

      if (result.success) {
        processedCount++;
      }
    }
  }

  return processedCount;
}

/**
 * `smb_message_echoes` field: outbound messages sent from the native WhatsApp
 * Business app under Coexistence. Signals human/agent takeover — flips the
 * conversation to agent_handling so the bot stops responding.
 */
async function dispatchEchoesChange(
  value: WaChangeValue,
  phoneNumberId: string,
  logger: Logger
): Promise<number> {
  if (!value.message_echoes) return 0;

  let processedCount = 0;
  for (const echo of value.message_echoes) {
    if (echo.type !== 'text' || !echo.text?.body) continue;

    const result = await withSystemScope(
      (conn) =>
        recordEchoMessage(conn, {
          pageId: phoneNumberId,
          externalUserId: echo.to,
          externalMessageId: echo.id,
          messageText: echo.text?.body ?? '',
          platform: 'whatsapp',
          timestamp: Number.parseInt(echo.timestamp, 10) * 1000,
        }),
      { db }
    );

    if (!result.success) {
      logger.warn(
        `Failed to record WhatsApp echo ${echo.id}: ${result.error.message}`
      );
    } else {
      processedCount++;
    }
  }
  return processedCount;
}

/**
 * `history` field: Coexistence history backfill — up to 6 months of prior 1:1
 * chats replayed by Meta during onboarding. Persist silently so prior chats
 * show in the inbox and give Claire conversation context.
 */
async function dispatchHistoryChange(
  value: WaChangeValue,
  phoneNumberId: string,
  logger: Logger
): Promise<number> {
  if (!value.history) return 0;

  let processedCount = 0;
  for (const chunk of value.history) {
    if (chunk.errors?.length) {
      logger.warn(
        `WhatsApp history sync error: ${JSON.stringify(chunk.errors)}`
      );
      continue;
    }

    for (const thread of chunk.threads ?? []) {
      const contactWaId = thread.id;
      if (!contactWaId) continue;

      for (const msg of thread.messages ?? []) {
        if (msg.type !== 'text' || !msg.text?.body) continue;

        // Direction: `from === contactWaId` means inbound (user);
        // otherwise it was sent by the business via the native app.
        const role = msg.from === contactWaId ? 'user' : 'agent';

        const result = await withSystemScope(
          (conn) =>
            ingestHistoricalMessage(conn, {
              pageId: phoneNumberId,
              externalUserId: contactWaId,
              externalMessageId: msg.id,
              messageText: msg.text?.body ?? '',
              role,
              timestamp: Number.parseInt(msg.timestamp, 10) * 1000,
              platform: 'whatsapp',
            }),
          { db }
        );

        if (!result.success) {
          logger.warn(
            `Failed to ingest WhatsApp history message ${msg.id}: ${result.error.message}`
          );
        } else {
          processedCount++;
        }
      }
    }

    if (chunk.metadata?.phase === 2 && chunk.metadata?.progress === 100) {
      const completeResult = await withSystemScope(
        (conn) =>
          markWhatsappHistoryComplete(conn, {
            phoneNumberId,
          }),
        { db }
      );
      if (!completeResult.success) {
        logger.warn(
          `Failed to mark WhatsApp history complete for ${phoneNumberId}: ${completeResult.error.message}`
        );
      } else {
        logger.log(
          `WhatsApp history sync complete for phone_number_id=${phoneNumberId}`
        );
      }
    }
  }
  return processedCount;
}

/**
 * `message_template_status_update` field: Meta pushes a template's approval
 * lifecycle (APPROVED / REJECTED / PAUSED / DISABLED / PENDING). WABA-scoped —
 * it carries no phone_number_id, so the org is resolved from the WABA id
 * (`entry.id`). Reconciles `whatsapp_template.status` so the campaign composer
 * and launch pre-flight reflect approval without a manual refresh.
 */
async function dispatchTemplateStatusChange(
  value: WaChangeValue,
  wabaId: string,
  logger: Logger
): Promise<number> {
  if (!value.event) return 0;

  const result = await withSystemScope(
    (conn) =>
      updateWhatsappTemplateStatus(conn, {
        wabaId,
        metaTemplateId:
          value.message_template_id != null
            ? String(value.message_template_id)
            : undefined,
        name: value.message_template_name,
        languageCode: value.message_template_language,
        event: value.event ?? '',
      }),
    { db }
  );

  if (!result.success) {
    logger.warn(
      `Failed to reconcile WhatsApp template status for waba=${wabaId}: ${result.error.message}`
    );
    return 0;
  }
  if (result.data.updated > 0) {
    logger.log(
      `WhatsApp template status reconciled: ${JSON.stringify({
        wabaId,
        template: value.message_template_name,
        event: value.event,
        status: result.data.status,
      })}`
    );
  }
  return result.data.updated;
}

/**
 * Walk the WhatsApp Cloud API envelope and dispatch every change.
 *
 * `rawBody` is the authenticated raw body handed over by
 * `WhatsAppSignatureGuard` (which has already rejected an empty body (400), an
 * unset META_APP_SECRET (500) and any bad signature (403)).
 */
export async function dispatchWhatsappWebhook(input: {
  rawBody: string;
  logger: Logger;
}): Promise<WhatsAppWebhookAck> {
  const { rawBody, logger } = input;

  logger.log('Received WhatsApp webhook');

  let payload: WaPayload;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    logger.warn('Invalid WhatsApp webhook JSON payload');
    throw new HttpException('Invalid JSON payload', HttpStatus.BAD_REQUEST);
  }

  if (payload.object !== 'whatsapp_business_account') {
    logger.log(`Ignoring non-WhatsApp payload: ${payload.object}`);
    return { success: true, processedCount: 0 };
  }

  let processedCount = 0;

  for (const entry of payload.entry) {
    // `entry.id` is the WhatsApp Business Account (WABA) id — the scope for
    // account-level fields like template-status updates, which carry no
    // phone_number_id.
    const wabaId = entry.id;
    for (const change of entry.changes) {
      const { value } = change;

      // Disposition FIRST, from the webhook registry. WhatsApp fields are
      // configured in the Meta app dashboard, so we cannot unsubscribe from
      // code — but a field we drop must say WHY, and a field the registry has
      // never heard of is an error, not a silent 200. The `default: // no-op
      // for now` this replaces is the same bug as Meta's `feed`.
      const disposition = dispositionOf('whatsapp', change.field);

      if (disposition.kind === 'ignored') {
        logger.debug(
          `Dropping whatsapp.${change.field} — declared ignoredBecause: ${disposition.because}`
        );
        continue;
      }

      if (disposition.kind === 'undeclared') {
        logError(
          'whatsapp.webhook.undeclaredEvent',
          new Error(
            `Meta delivered an undeclared WhatsApp field "${change.field}". Add it to the webhook registry with a handler or an ignoredBecause reason.`
          ),
          {
            feature: 'webhooks',
            extra: { provider: 'whatsapp', field: change.field },
          }
        );
        continue;
      }

      // Template-status is WABA-scoped and has no phone_number_id; the
      // message/echo/history handlers below are phone-number-scoped and guard
      // on it individually (the guard used to sit at the top of the loop, but
      // that silently dropped account-level fields before disposition).
      const phoneNumberId = value.metadata?.phone_number_id;

      switch (change.field) {
        case 'messages':
          if (!phoneNumberId) break;
          processedCount += await dispatchMessagesChange(
            value,
            phoneNumberId,
            logger
          );
          break;

        case 'smb_message_echoes':
          if (!phoneNumberId) break;
          processedCount += await dispatchEchoesChange(
            value,
            phoneNumberId,
            logger
          );
          break;

        case 'history':
          if (!phoneNumberId) break;
          processedCount += await dispatchHistoryChange(
            value,
            phoneNumberId,
            logger
          );
          break;

        case 'message_template_status_update':
          processedCount += await dispatchTemplateStatusChange(
            value,
            wabaId,
            logger
          );
          break;

        default:
          // Unreachable: the registry declares this field `handled()`, and
          // `whatsapp-registry.spec.ts` asserts the `case` labels below match
          // the registry's handled set exactly. Reaching here means a handled
          // event lost its case — loud, never silent.
          logError(
            'whatsapp.webhook.handlerMismatch',
            new Error(
              `whatsapp.${change.field} is declared handled() in the webhook registry but has no case in the dispatch switch`
            ),
            { feature: 'webhooks', extra: { field: change.field } }
          );
          break;
      }
    }
  }

  logger.log(`WhatsApp webhook processed: ${processedCount} events`);
  return { success: true, processedCount };
}
