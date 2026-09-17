import { z } from 'zod';

export const handleIncomingMessageSchema = z.object({
  pageId: z.string().min(1, 'Page ID is required'),
  senderId: z.string().min(1, 'Sender ID is required'),
  senderName: z.string().optional(),
  messageText: z.string().optional(),
  messageId: z.string().optional(),
  /**
   * Non-text payloads (stickers, emoji reactions, images/attachments). Without
   * these, such messages are stored blank and render as empty inbox bubbles.
   */
  attachments: z
    .array(
      z.object({
        type: z.string().optional(),
        payload: z
          .object({
            url: z.string().optional(),
            sticker_id: z.union([z.string(), z.number()]).optional(),
            title: z.string().optional(),
          })
          .optional(),
      })
    )
    .optional(),
  stickerId: z.union([z.string(), z.number()]).optional(),
  reaction: z.string().optional(),
  platform: z.enum(['facebook_messenger', 'instagram_dm', 'whatsapp', 'sms']),
  timestamp: z.number().optional(),
  queueDelayMs: z.number().optional(),
  /** When true, bot messages are saved to DB but not sent via Meta/WhatsApp API (for E2E testing) */
  skipExternalDelivery: z.boolean().optional(),
  adReferral: z
    .object({
      metaAdId: z.string(),
      source: z.string().optional(),
      adTitle: z.string().optional(),
      adPhotoUrl: z.string().optional(),
      adVideoUrl: z.string().optional(),
    })
    .optional(),
});

export type HandleIncomingMessageInput = z.infer<
  typeof handleIncomingMessageSchema
>;
