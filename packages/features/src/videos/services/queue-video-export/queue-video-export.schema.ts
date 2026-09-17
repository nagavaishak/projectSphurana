import { z } from 'zod';

/**
 * Job priority levels
 * Lower number = higher priority
 *
 * - HIGH (1): Paying customers, urgent renders
 * - NORMAL (5): Standard renders
 * - LOW (10): Batch/background renders, free tier
 */
export const VIDEO_PRIORITY = {
  HIGH: 1,
  NORMAL: 5,
  LOW: 10,
} as const;

export type VideoPriority =
  (typeof VIDEO_PRIORITY)[keyof typeof VIDEO_PRIORITY];

/**
 * Queue video export input schema
 */
export const queueVideoExportSchema = z.object({
  id: z.string().min(1, 'Video ID is required'),
  /** Job priority - lower number = higher priority. Default: NORMAL (5) */
  priority: z.number().min(1).max(10).optional().default(VIDEO_PRIORITY.NORMAL),
  /**
   * User opt-in for curated stock b-roll browsing/top-up flows. Empty b-roll
   * stock-eligible videos are still auto-filled at render time so Quick Create
   * and Claire can render when no uploaded clips were provided.
   */
  allowStockFootage: z.boolean().optional().default(true),
  /**
   * When the render was initiated from a Claire-on-WhatsApp conversation, the
   * owner has no client to poll for completion — so we tag the render with the
   * conversation to deliver into. On completion the video worker enqueues a
   * proactive WhatsApp delivery (claire-whatsapp-outbound). Omitted for web
   * renders (web polls client-side).
   */
  whatsappDelivery: z.object({ conversationId: z.string().min(1) }).optional(),
});

/** Input type (before parsing - priority is optional) */
export type QueueVideoExportInput = z.input<typeof queueVideoExportSchema>;

/** Output type (after parsing - priority has default applied) */
export type QueueVideoExportParsed = z.infer<typeof queueVideoExportSchema>;
