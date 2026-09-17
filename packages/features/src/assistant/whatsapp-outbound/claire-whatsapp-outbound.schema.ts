import { z } from 'zod';

/**
 * BullMQ queue name for proactively delivering content to a paired
 * Claire-on-WhatsApp owner OUTSIDE the reactive inbound-turn loop.
 *
 * Why this exists: the web assistant surfaces async results (a finished video
 * render, a generated graphic, a completed batch) by client-side polling.
 * WhatsApp has no client to poll, so nothing reaches the owner unless we push
 * it. This is the generic transport for that push — resolve the owner's number
 * from the conversation, deliver the sends, and record the turn so the thread
 * stays coherent (and the inbound history loader picks it up on the next reply).
 *
 * Producers live wherever an async job completes (e.g. the video render worker).
 * The single consumer lives in the API's `chatbot-worker`, which owns the
 * `CLAIRE_WHATSAPP_*` secrets + `WhatsAppCloudService`. Keeping delivery in one
 * place keeps WABA creds out of every producer app.
 *
 * SCOPE (first cut): free-form text/media only, which Meta permits while the
 * owner is inside the 24h customer-service window (true for an async result of
 * something they just asked Claire to do). Genuinely proactive, out-of-window
 * events (a new lead, a new customer message) require an APPROVED template —
 * that path is handled by `proactive-nudges` today; a future `template` variant
 * on this payload can fold those onto this same transport.
 */
export const CLAIRE_WHATSAPP_OUTBOUND_QUEUE = 'claire-whatsapp-outbound';

/** A single free-form outbound bubble. Mirrors the turn renderer's `WhatsappSend`. */
export const claireOutboundMessageSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('text'),
    body: z.string().min(1),
  }),
  z.object({
    kind: z.literal('media'),
    mediaType: z.enum(['image', 'video']),
    /** Publicly fetchable URL (CDN / org-assets). */
    link: z.string().min(1),
    caption: z.string().optional(),
  }),
]);

export type ClaireOutboundMessage = z.infer<typeof claireOutboundMessageSchema>;

export const claireWhatsappOutboundJobSchema = z.object({
  organizationId: z.string().min(1),
  userId: z.string().min(1),
  /** The persistent whatsapp conversation to deliver into. */
  conversationId: z.string().min(1),
  /** Ordered free-form bubbles delivered to the owner. */
  messages: z.array(claireOutboundMessageSchema).min(1),
  /**
   * Text recorded as the assistant turn in conversation history (so the next
   * inbound reply has context, mirroring `proactive-nudges`). Omit to record
   * nothing.
   */
  recordAs: z.string().optional(),
  /**
   * Deterministic idempotency key → BullMQ jobId. Producers that may fire a
   * completion more than once (e.g. a render retried) pass a stable key like
   * `video-ready:<videoId>` so the owner isn't messaged twice.
   */
  dedupeKey: z.string().optional(),
});

export type ClaireWhatsappOutboundJobPayload = z.infer<
  typeof claireWhatsappOutboundJobSchema
> & {
  queuedAt?: string;
};
