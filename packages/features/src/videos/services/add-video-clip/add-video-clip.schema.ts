import { z } from 'zod';

/**
 * Add video clip input schema
 * Used by mobile app to add talking head or b-roll clips
 */
export const addVideoClipSchema = z.object({
  videoId: z.string().min(1, 'Video ID is required'),
  slotType: z.enum(['talkingHead', 'bRoll']),
  assetId: z.string().min(1, 'Asset ID is required'),
  url: z.string().url('Valid URL is required'),
  /** Order in the timeline (required for b-roll, ignored for talking head) */
  order: z.number().int().nonnegative().optional(),
  /** Clip type for template-specific ordering */
  clipType: z.enum(['before', 'after', 'bRoll']).optional(),
});

export type AddVideoClipInput = z.infer<typeof addVideoClipSchema>;
