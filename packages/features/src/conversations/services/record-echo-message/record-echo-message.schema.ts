import { z } from 'zod';

export const recordEchoMessageSchema = z.object({
  /** The Meta page ID that sent the echo (recipient.id for incoming, sender.id for echo) */
  pageId: z.string().min(1),
  /** The external user ID the page is talking to */
  externalUserId: z.string().min(1),
  /** External message ID (mid) for deduplication */
  externalMessageId: z.string().min(1),
  /** Message text content */
  messageText: z.string().optional(),
  /** Platform */
  platform: z.enum(['facebook_messenger', 'instagram_dm', 'whatsapp']),
  /** Timestamp from webhook */
  timestamp: z.number().optional(),
  /**
   * Observability fields — the discriminating signals for "what is this echo?".
   * `app_id` is Meta's origin marker: present → sent through an app's API (our
   * bot when it matches our app); absent → Page inbox (human) or page-native
   * automation (Instagram Instant Reply / auto-responder).
   */
  appId: z.string().optional(),
  /** True when `app_id` matches our own Meta app (i.e. this is our own send). */
  isOwnAppEcho: z.boolean().optional(),
  /** Normalized attachment kinds carried by the echo (empty for text/none). */
  attachmentTypes: z.array(z.string()).optional(),
  /** Whether the echo carried Meta `metadata` (set when we send via the API). */
  hasAppMetadata: z.boolean().optional(),
});

export type RecordEchoMessageInput = z.infer<typeof recordEchoMessageSchema>;
