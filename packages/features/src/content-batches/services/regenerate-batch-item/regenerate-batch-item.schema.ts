import { z } from 'zod';

export const regenerateBatchItemSchema = z.object({
  itemId: z.string().min(1, 'Item ID is required'),
  organizationId: z.string().min(1, 'Organization ID is required'),
  createdById: z.string().min(1, 'createdById is required'),

  // Optional free-text reason captured by the swipe UI / modal so we can
  // feed it back into AI generation in a later iteration. Capped short
  // because longer feedback should go elsewhere.
  reason: z.string().max(280).optional(),

  // For carousel graphics: 0-based slide to refine. When set, only that slide
  // re-renders (from its prior image, pinned template) and the other slides are
  // preserved. Absent = regenerate the whole asset. Ignored for videos.
  slideIndex: z.number().int().min(0).optional(),

  // A per-slide instruction list — what the review thread proposes and the
  // owner confirms. Supersedes `reason`/`slideIndex`, which say the same thing
  // for the simpler cases and are what the direct buttons still send.
  //
  //   [{ slideIndex: null, note }]   the whole asset, or every slide of a deck
  //   [{ slideIndex: 1, note }]      one slide; the others preserved
  //   [{ 0, … }, { 1, … }]           a different instruction per slide, ONE render
  edits: z
    .array(
      z.object({
        slideIndex: z.number().int().min(0).nullable(),
        /** `refine` re-renders the slide; `remove` drops it from the deck. */
        op: z.enum(['refine', 'remove']).default('refine'),
        note: z.string().max(280).optional(),
        /** What to hold fixed — see `regeneration-intent.ts`. */
        intent: z.enum(['copy', 'image', 'branding', 'full']).optional(),
      })
    )
    .min(1)
    .max(10)
    .optional(),
});

export type RegenerateBatchItemInput = z.infer<
  typeof regenerateBatchItemSchema
>;
