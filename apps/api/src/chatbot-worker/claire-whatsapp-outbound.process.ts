import { db } from '@borradh-workspace/database';
import {
  type ClaireWhatsappOutboundJobPayload,
  getWhatsappConversationTarget,
  saveMessages,
} from '@borradh-workspace/features/assistant';
import type { WhatsAppCloudService } from '@borradh-workspace/integrations/whatsapp';
import { createLogger, logError } from '@borradh-workspace/observability';
import {
  type WhatsappSend,
  deliverWhatsappSends,
} from '../assistant/lib/render-whatsapp-turn.js';
import { buildClaireWhatsappService } from './claire-whatsapp-turn.process.js';

const logger = createLogger('ClaireWhatsappOutbound');

export interface ClaireWhatsappOutboundDeps {
  /** The WhatsApp send service (Claire WABA creds in prod; a capturing stub in
   *  tests). Default: a real `WhatsAppCloudService` on the Claire credentials. */
  whatsappService?: Pick<
    WhatsAppCloudService,
    'sendTextMessage' | 'sendMediaMessage' | 'sendInteractiveMessage'
  >;
}

export interface ClaireWhatsappOutboundResult {
  delivered: boolean;
  /** Why a delivery was skipped (no paired number / empty), if it was. */
  skippedReason?: 'no_phone';
  sends: WhatsappSend[];
}

/**
 * Deliver a proactive/async result to a paired Claire-on-WhatsApp owner.
 *
 * The generic counterpart to the reactive turn worker: instead of running a
 * Claire turn, it takes already-composed free-form bubbles (e.g. a finished
 * video) and pushes them to the owner's number, then records the send as an
 * assistant turn so the thread stays coherent and the inbound history loader
 * picks it up on the owner's next reply.
 *
 * Free-form sends are valid here because this transport is (today) only used
 * for async results of something the owner just asked Claire for — they're
 * inside WhatsApp's 24h customer-service window. Out-of-window proactive events
 * must use an approved template (see `proactive-nudges`).
 */
export async function processClaireWhatsappOutbound(
  payload: ClaireWhatsappOutboundJobPayload,
  deps: ClaireWhatsappOutboundDeps = {}
): Promise<ClaireWhatsappOutboundResult> {
  const { organizationId, userId, conversationId, messages, recordAs } =
    payload;

  // Resolve the owner's paired number from the conversation.
  const targetResult = await getWhatsappConversationTarget(db, {
    conversationId,
    organizationId,
  });
  if (!targetResult.success) {
    throw new Error(
      `Failed to resolve outbound target: ${targetResult.error.message}`
    );
  }

  const phoneE164 = targetResult.data.phoneE164;
  if (!phoneE164) {
    // The owner unpaired/revoked since the job was queued. Nothing to deliver;
    // don't fail the job (no retry will produce a number).
    logger.warn('Outbound delivery skipped: no paired number', {
      conversationId,
      organizationId,
    });
    return { delivered: false, skippedReason: 'no_phone', sends: [] };
  }

  // The queue payload's message shape is identical to the turn renderer's
  // `WhatsappSend`; reuse the same async executor so delivery behaves exactly
  // like an inbound-turn send.
  const sends: WhatsappSend[] = messages.map((m) =>
    m.kind === 'text'
      ? { kind: 'text', body: m.body }
      : {
          kind: 'media',
          mediaType: m.mediaType,
          link: m.link,
          ...(m.caption ? { caption: m.caption } : {}),
        }
  );

  const service = deps.whatsappService ?? buildClaireWhatsappService();
  await deliverWhatsappSends(service, phoneE164, sends);

  // Record the proactive turn (best-effort — the message already went out).
  // Mirrors `proactive-nudges`: an empty user row + the assistant text.
  if (recordAs) {
    try {
      await saveMessages(db, {
        conversationId,
        organizationId,
        userId,
        userMessageContent: '',
        assistantText: recordAs,
      });
    } catch (error) {
      logError('assistant.claireWhatsappOutbound.saveMessages', error, {
        feature: 'assistant',
        extra: { conversationId },
      });
    }
  }

  logger.info('Delivered Claire WhatsApp outbound', {
    conversationId,
    organizationId,
    bubbles: sends.length,
  });

  return { delivered: true, sends };
}
