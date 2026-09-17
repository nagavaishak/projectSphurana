import { z } from 'zod';

/**
 * Wire shapes for the events we accept.
 *
 * These are deliberately PERMISSIVE (everything optional, objects passthrough).
 * Meta and Stripe add fields without warning, and a strict schema at the
 * ingress would turn an additive provider change into a dropped webhook. The
 * schemas exist to (a) type the handler argument and (b) prove the envelope is
 * shaped roughly as expected — not to police the provider.
 */

const passthrough = z.object({}).passthrough();

// ---------------------------------------------------------------- Meta shared

export const metaAdsContextDataSchema = z
  .object({
    ad_title: z.string().optional(),
    photo_url: z.string().optional(),
    video_url: z.string().optional(),
    post_id: z.string().optional(),
  })
  .passthrough();

export const metaReferralSchema = z
  .object({
    ref: z.string().optional(),
    source: z.string().optional(),
    type: z.string().optional(),
    ad_id: z.string().optional(),
    ads_context_data: metaAdsContextDataSchema.optional(),
  })
  .passthrough();

export const metaMessageSchema = z
  .object({
    // Optional on purpose. A required field here is not validation, it is a
    // silent outage: the controller safeParses, logs, `continue`s and still
    // returns 200 — and Meta NEVER retries a 200, so the customer's message is
    // gone forever. The downstream contract (handle-incoming-message.schema.ts,
    // unchanged from main) already treats `messageId` as optional, so main would
    // have processed a message without one. Match it.
    mid: z.string().optional(),
    text: z.string().optional(),
    is_echo: z.boolean().optional(),
    /**
     * Echo-only origin marker: present when the message was sent through an
     * app's API (our bot when it matches our app id); absent for Page-inbox
     * (human) or page-native automation echoes.
     */
    app_id: z.union([z.number(), z.string()]).optional(),
    metadata: z.string().optional(),
    quick_reply: z.object({ payload: z.string() }).passthrough().optional(),
    // type/payload optional: Meta ships attachment shapes that carry neither
    // (e.g. a bare `fallback`). Requiring them would 200-drop the whole message.
    attachments: z
      .array(
        z
          .object({
            type: z.string().optional(),
            payload: z
              .object({
                url: z.string().optional(),
                sticker_id: z.union([z.number(), z.string()]).optional(),
              })
              .passthrough()
              .optional(),
          })
          .passthrough()
      )
      .optional(),
    referral: metaReferralSchema.optional(),
  })
  .passthrough();

/**
 * A single element of `entry[].messaging[]`. Which optional key is present is
 * what discriminates the subscription field the event came from — see
 * `classifyMetaMessagingEvent`.
 */
export const metaMessagingEventSchema = z
  .object({
    // sender/recipient stay required: they ARE the envelope identity the
    // docblock's "shaped roughly as expected" check is for, and a message
    // without a sender is unactionable anyway.
    sender: z.object({ id: z.string() }).passthrough(),
    recipient: z.object({ id: z.string() }).passthrough(),
    // Optional: downstream treats it as optional, so a missing timestamp must
    // not cost us the message.
    timestamp: z.number().optional(),
    message: metaMessageSchema.optional(),
    delivery: z.unknown().optional(),
    read: z.unknown().optional(),
    postback: z.unknown().optional(),
    optin: z.unknown().optional(),
    reaction: z.unknown().optional(),
    referral: metaReferralSchema.optional(),
  })
  .passthrough();

export type MetaMessagingEvent = z.infer<typeof metaMessagingEventSchema>;

/** A single element of `entry[].changes[]` for a Page. */
export const metaChangeSchema = z
  .object({
    field: z.string(),
    value: passthrough.optional(),
  })
  .passthrough();

export type MetaChange = z.infer<typeof metaChangeSchema>;

export const metaLeadgenChangeSchema = z
  .object({
    field: z.literal('leadgen'),
    value: z
      .object({
        leadgen_id: z.union([z.string(), z.number()]).optional(),
        form_id: z.union([z.string(), z.number()]).optional(),
        page_id: z.union([z.string(), z.number()]).optional(),
        ad_id: z.union([z.string(), z.number()]).optional(),
        created_time: z.number().optional(),
      })
      .passthrough(),
  })
  .passthrough();

export const metaFeedChangeSchema = z
  .object({
    field: z.literal('feed'),
    value: passthrough,
  })
  .passthrough();

// ------------------------------------------------------------------- WhatsApp

/** A single element of `entry[].changes[]` on a WhatsApp Business Account. */
export const whatsappChangeSchema = z
  .object({
    field: z.string(),
    value: passthrough,
  })
  .passthrough();

export type WhatsappChange = z.infer<typeof whatsappChangeSchema>;

// --------------------------------------------------------------------- Stripe

/**
 * Stripe events are already validated by signature + `constructEvent`, and the
 * `stripe` package ships exact types. The registry only needs the envelope.
 */
export const stripeEventSchema = z
  .object({
    id: z.string(),
    type: z.string(),
    data: z.object({ object: passthrough }).passthrough(),
  })
  .passthrough();

export type StripeWebhookEnvelope = z.infer<typeof stripeEventSchema>;
