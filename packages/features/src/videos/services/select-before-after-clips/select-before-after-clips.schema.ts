import { z } from 'zod';

/**
 * Input for `selectBeforeAfterClips`. Resolves a renderable before/after clip
 * set for the one-prompt creation flow.
 */
export const selectBeforeAfterClipsSchema = z.object({
  organizationId: z.string().min(1, 'Organization ID is required'),
  /** Optional service to prefer procedure footage from. */
  serviceId: z.string().min(1).optional(),
  /**
   * How many procedure (`bRoll`) clips to place between the before and after
   * assets. The before + after assets always render; this just controls the
   * length of the transformation montage in the middle.
   */
  procedureClipCount: z.coerce.number().int().min(0).max(6).default(1),
});

export type SelectBeforeAfterClipsInput = z.infer<
  typeof selectBeforeAfterClipsSchema
>;

/** A single resolved clip in template order. */
export interface BeforeAfterClip {
  assetId: string;
  order: number;
  clipType: 'before' | 'after' | 'bRoll';
}

export interface SelectBeforeAfterClipsOutput {
  /** Ordered clips: before → procedure(s) → after. */
  clips: BeforeAfterClip[];
}
