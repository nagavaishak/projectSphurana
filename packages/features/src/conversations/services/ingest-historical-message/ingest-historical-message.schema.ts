import { z } from 'zod';

export const ingestHistoricalMessageSchema = z.object({
  /** phone_number_id the WABA is messaging from */
  pageId: z.string().min(1),
  /** The contact's wa_id (user phone number) */
  externalUserId: z.string().min(1),
  /** wamid of the historical message — dedup key */
  externalMessageId: z.string().min(1),
  /** Message text content (empty string allowed for non-text fallbacks) */
  messageText: z.string(),
  /** 'user' for inbound, 'agent' for outbound (native WA Business app = human) */
  role: z.enum(['user', 'agent']),
  /** ms-since-epoch timestamp (webhook `timestamp * 1000`) */
  timestamp: z.number(),
  /** Only 'whatsapp' is supported today — Coexistence is WA-specific */
  platform: z.literal('whatsapp'),
});

export type IngestHistoricalMessageInput = z.infer<
  typeof ingestHistoricalMessageSchema
>;
