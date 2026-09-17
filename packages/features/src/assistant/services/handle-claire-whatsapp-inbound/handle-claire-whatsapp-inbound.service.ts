import { withSystemScope } from '@borradh-workspace/database';
import { apiEnv } from '@borradh-workspace/env/api';
import { WhatsAppCloudService } from '@borradh-workspace/integrations/whatsapp';
import { logError } from '@borradh-workspace/observability';
import type { DbConnection } from '../../../shared/index.js';
import { queueClaireWhatsappTurn } from '../../whatsapp-turn-queue/index.js';
import { resolveOwnerByPhone } from '../resolve-owner-by-phone/index.js';
import { verifyWhatsappLink } from '../verify-whatsapp-link/index.js';

/**
 * Claire-on-WhatsApp INBOUND PIPELINE (WS-10).
 *
 * Lifted verbatim out of `whatsapp-webhooks.controller.ts::handleClaireInbound`
 * (Gate 5 — a controller may only call a use case and return it). Behaviour is
 * unchanged, including the exact decision-log lines, the reply copy, the branch
 * ORDER, and the "every failure is swallowed" posture: every outbound send is
 * individually try/caught so a Meta send failure can never turn the webhook ack
 * into a non-2xx (Meta retries with backoff on non-2xx, which duplicates real
 * customer messages).
 *
 * Returns `true` when the message was handled by the Claire path (so the caller
 * must NOT fall through to the receptionist `handleIncomingMessage`). Returns
 * `false` when this is NOT a Claire message — flag off, wrong number, or the
 * dedicated number isn't configured — leaving the receptionist path on the
 * OTHER number completely untouched.
 *
 * Behaviour on the dedicated Claire number:
 *   - Non-text (image/voice/sticker) → friendly "text only" reply. Handled.
 *   - STOP keyword → opt-out ack (Meta compliance). Handled.
 *   - START keyword → re-subscribe ack. Handled.
 *   - Pairing code (6 digits) → `verifyWhatsappLink`; confirm or friendly
 *     retry. Always handled (true).
 *   - Paired owner → enqueue a `claire-whatsapp-turn` job. Handled (true).
 *   - Unknown sender → handled (true) — the dedicated number has NO
 *     receptionist; we ignore it (optionally one short reply).
 *
 * NOT a `Result<T>`/`trackedResult` service on purpose: the caller's contract is
 * the tri-state "did the Claire branch take this message", and wrapping it would
 * add PostHog/Sentry events this path never emitted before — an observable
 * change to a hot webhook.
 */

/**
 * Structural logger so this stays free of a `@nestjs/common` dependency while
 * the webhook keeps passing its own `Logger` instance — the emitted lines
 * (context prefix included) are byte-identical to before the move.
 */
export interface ClaireInboundLogger {
  log(message: string): void;
  debug(message: string): void;
}

export interface HandleClaireWhatsappInboundInput {
  phoneNumberId: string;
  fromPhoneE164: string;
  messageText: string | null;
  messageType: string;
  inboundMessageId: string;
}

/**
 * Extracts a 6-digit pairing code from anywhere in the message (WS-3 format),
 * e.g. the prefilled "Connect me to Claire — code 123456". Returns null if no
 * 6-digit group is present. Only consulted for senders who are NOT already a
 * paired owner, so a paired owner's normal message that happens to contain a
 * 6-digit number (e.g. a budget) is never mistaken for a pairing attempt.
 */
function extractPairingCode(text: string): string | null {
  const match = text.match(/\b\d{6}\b/);
  return match ? match[0] : null;
}

/**
 * Last-4 redaction for phone numbers in logs — enough to correlate a report
 * ("I messaged from ...1234") without dumping full E.164 PII into log storage.
 */
function redactPhone(phone: string): string {
  return phone.length <= 4 ? '****' : `***${phone.slice(-4)}`;
}

/**
 * Structured, single-line routing trail for the dedicated Claire number.
 * This is the forensics record for "I messaged Claire and nothing happened":
 * every inbound on the Claire number records which branch handled it (or why),
 * with the phone_number_id so a misconfigured number is obvious at a glance.
 * Phone is redacted to last-4. Logged at `info` so it survives prod log level.
 */
export function logClaireDecision(
  logger: ClaireInboundLogger,
  decision: string,
  ctx: {
    phoneNumberId: string;
    fromPhoneE164: string;
    inboundMessageId: string;
    messageType?: string;
    extra?: Record<string, unknown>;
  }
): void {
  logger.log(
    `Claire WhatsApp inbound → ${decision} ${JSON.stringify({
      decision,
      phoneNumberId: ctx.phoneNumberId,
      from: redactPhone(ctx.fromPhoneE164),
      inboundMessageId: ctx.inboundMessageId,
      messageType: ctx.messageType,
      ...(ctx.extra ?? {}),
    })}`
  );
}

export async function handleClaireWhatsappInbound(
  db: DbConnection,
  input: HandleClaireWhatsappInboundInput,
  logger: ClaireInboundLogger
): Promise<boolean> {
  const {
    phoneNumberId,
    fromPhoneE164,
    messageText,
    messageType,
    inboundMessageId,
  } = input;

  const claireNumberId = apiEnv.CLAIRE_WHATSAPP_PHONE_NUMBER_ID;
  // No-op unless the flag is on AND this is the dedicated Claire number.
  // We log the skip at `debug` only (this fires for every receptionist
  // message on the OTHER number — logging at info would flood). The
  // per-change phone_number_id line in the POST handler gives the visibility.
  if (
    !apiEnv.CLAIRE_WHATSAPP_ENABLED ||
    !claireNumberId ||
    phoneNumberId !== claireNumberId
  ) {
    logger.debug(
      `Claire WhatsApp inbound skipped: ${JSON.stringify({
        enabled: apiEnv.CLAIRE_WHATSAPP_ENABLED,
        hasClaireNumberId: Boolean(claireNumberId),
        phoneNumberId,
        matchesClaireNumber:
          Boolean(claireNumberId) && phoneNumberId === claireNumberId,
      })}`
    );
    return false;
  }

  const claireService = new WhatsAppCloudService(
    apiEnv.CLAIRE_WHATSAPP_ACCESS_TOKEN,
    claireNumberId
  );

  // 0a. Non-text message (image, voice note, sticker, etc.) — Claire is
  //     text-only today. Reply with a friendly nudge rather than silence.
  if (messageType !== 'text' || !messageText) {
    logClaireDecision(logger, 'non_text_nudge', {
      phoneNumberId,
      fromPhoneE164,
      inboundMessageId,
      messageType,
    });
    try {
      await claireService.sendTextMessage(
        fromPhoneE164,
        "I can only read text messages for now — try typing what you need and I'll help!"
      );
    } catch (error) {
      logError('whatsapp.claire.nonTextReply', error, {
        feature: 'assistant',
      });
    }
    return true;
  }

  // 0b. STOP / unsubscribe keyword — Meta compliance for proactive messages.
  //     Acknowledge immediately. The actual opt-out is env-stubbed (see
  //     proactive-nudges/opt-out.ts); a persistent column is a follow-up.
  if (/^\s*(stop|unsubscribe)\s*$/i.test(messageText)) {
    logClaireDecision(logger, 'stop_optout', {
      phoneNumberId,
      fromPhoneE164,
      inboundMessageId,
    });
    try {
      await claireService.sendTextMessage(
        fromPhoneE164,
        "You've been unsubscribed from proactive messages. You can still message me anytime — I just won't reach out first. Send START to re-subscribe."
      );
    } catch (error) {
      logError('whatsapp.claire.stopReply', error, { feature: 'assistant' });
    }
    return true;
  }

  // 0c. START keyword — re-subscribe to proactive messages.
  if (/^\s*start\s*$/i.test(messageText)) {
    logClaireDecision(logger, 'start_resubscribe', {
      phoneNumberId,
      fromPhoneE164,
      inboundMessageId,
    });
    try {
      await claireService.sendTextMessage(
        fromPhoneE164,
        "Welcome back! You'll receive proactive updates again. Send STOP anytime to opt out."
      );
    } catch (error) {
      logError('whatsapp.claire.startReply', error, { feature: 'assistant' });
    }
    return true;
  }

  // 1. Already-paired owner? Enqueue a Claire turn and return early. Checked
  //    FIRST so a normal message that happens to contain a 6-digit number is
  //    never misread as a pairing code. (Owners never need to re-pair.)
  const ownerResult = await withSystemScope(
    (conn) => resolveOwnerByPhone(conn, fromPhoneE164),
    { db }
  );
  if (ownerResult.success && ownerResult.data) {
    const { userId, organizationId } = ownerResult.data;
    const queued = await queueClaireWhatsappTurn({
      userId,
      organizationId,
      fromPhoneE164,
      userMessage: messageText,
      inboundMessageId,
    });
    logClaireDecision(
      logger,
      queued.success ? 'owner_turn_queued' : 'owner_turn_queue_failed',
      {
        phoneNumberId,
        fromPhoneE164,
        inboundMessageId,
        extra: {
          userId,
          organizationId,
          ...(queued.success ? {} : { error: queued.error.message }),
        },
      }
    );
    if (!queued.success) {
      logError('whatsapp.claire.enqueue', new Error(queued.error.message), {
        feature: 'assistant',
        extra: { organizationId },
      });
    }
    return true;
  }

  // 2. Not yet paired — does the message carry a pairing code? Verify
  //    ownership + drop them straight into a live chat with a warm greeting.
  const code = extractPairingCode(messageText);
  if (code) {
    const verifyResult = await withSystemScope(
      (conn) => verifyWhatsappLink(conn, { code, fromPhoneE164 }),
      { db }
    );
    logClaireDecision(
      logger,
      verifyResult.success ? 'pairing_verified' : 'pairing_failed',
      {
        phoneNumberId,
        fromPhoneE164,
        inboundMessageId,
        extra: verifyResult.success
          ? {
              userId: verifyResult.data.userId,
              organizationId: verifyResult.data.organizationId,
            }
          : {
              errorCode: verifyResult.error.code,
              errorMessage: verifyResult.error.message,
            },
      }
    );
    try {
      if (verifyResult.success) {
        await claireService.sendTextMessage(
          fromPhoneE164,
          'You\'re connected 🎉 I\'m Claire — I can run your marketing right from here. Want to:\n\n• "create a campaign"\n• "how are my leads doing?"\n\nOr just tell me what you need.'
        );
      } else {
        await claireService.sendTextMessage(
          fromPhoneE164,
          "That code didn't match or has expired. Open Claire settings in the app and start pairing again to get a fresh code."
        );
      }
    } catch (error) {
      logError('whatsapp.claire.pairingReply', error, {
        feature: 'assistant',
      });
    }
    return true;
  }

  // 3. Unknown sender on the dedicated number — no receptionist here. Ignore
  //    (a single, minimal "this number is for account owners" reply).
  logClaireDecision(logger, 'unknown_sender', {
    phoneNumberId,
    fromPhoneE164,
    inboundMessageId,
  });
  try {
    await claireService.sendTextMessage(
      fromPhoneE164,
      'This number is for connected account owners. To use Claire here, pair your number from Claire settings in the app.'
    );
  } catch (error) {
    logError('whatsapp.claire.unknownSenderReply', error, {
      feature: 'assistant',
    });
  }
  return true;
}
