import { z } from 'zod';

/** BullMQ queue name for inbound Claire-on-WhatsApp owner turns. */
export const CLAIRE_WHATSAPP_TURN_QUEUE = 'claire-whatsapp-turn';

/**
 * Payload enqueued by the webhook (WS-10) when a paired owner texts the
 * dedicated Claire number. The worker resolves the conversation, runs a full
 * Claire turn, and delivers the rendered sends back to WhatsApp.
 */
export const claireWhatsappTurnJobSchema = z.object({
  userId: z.string().min(1),
  organizationId: z.string().min(1),
  /** Owner's E.164 number (digits only, no '+') — both the conversation key
   *  and the outbound recipient. */
  fromPhoneE164: z.string().min(1),
  /** The inbound message text. */
  userMessage: z.string(),
  /** The inbound WhatsApp message id (dedupe / idempotency key). */
  inboundMessageId: z.string().min(1),
});

export type ClaireWhatsappTurnJobPayload = z.infer<
  typeof claireWhatsappTurnJobSchema
> & {
  queuedAt?: string;
};
