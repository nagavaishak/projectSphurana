import { z } from 'zod';

/**
 * Re-roll an existing standalone graphic (the create-post review modal),
 * applying a free-text change request. Pins the original's template so the
 * design doesn't drift, and supports refining a single carousel slide.
 */
export const regenerateGraphicSchema = z
  .object({
    organizationId: z.string().min(1, 'Organization ID is required'),
    graphicId: z.string().min(1, 'graphicId is required'),
    createdById: z.string().min(1, 'createdById is required'),
    /**
     * The batch this re-roll belongs to, when it is a monthly-batch post rather
     * than a standalone graphic. Carried through to the render job purely so
     * the worker's log line names the batch — nothing branches on it.
     */
    contentBatchId: z.string().min(1).optional(),
    /** The user's change request. */
    refinementInstruction: z.string().max(500).optional(),
    /**
     * `all` re-renders the whole graphic (pinned template); `slide` refines just
     * `slideIndex` of a carousel and preserves the other slides.
     */
    scope: z.enum(['all', 'slide']).default('all'),
    /** Required when scope = 'slide'. 0-based. */
    slideIndex: z.number().int().min(0).optional(),
    /**
     * TARGETED per-slide refine: a different instruction for each named slide,
     * in ONE render. Slides not named are preserved verbatim.
     *
     * Supersedes `scope`/`slideIndex` when present — those express the same
     * thing for exactly one slide, and are kept because the assistant tool and
     * the create-post modal speak that shape. Both are normalised to this list
     * before the job is queued, so the worker has one representation to
     * understand rather than two.
     */
    slideEdits: z
      .array(
        z
          .object({
            slideIndex: z.number().int().min(0),
            /** `refine` re-renders it; `remove` drops it from the deck. */
            op: z.enum(['refine', 'remove']).default('refine'),
            note: z.string().max(280).optional(),
          })
          .superRefine((edit, ctx) => {
            if (edit.op === 'refine' && !edit.note?.trim()) {
              ctx.addIssue({
                code: 'custom',
                path: ['note'],
                message: 'A refined slide needs an instruction',
              });
            }
          })
      )
      .min(1)
      .max(10)
      .optional(),
    /** Replacement uploaded images; one for a slide, up to ten for all. */
    sourceAssetIds: z.array(z.string().min(1)).min(1).max(10).optional(),

    /**
     * What is being changed: the words (`copy`), the photography (`image`), or
     * everything (`full`). Omitted, it is inferred — `sourceAssetIds` implies
     * an image change, a bare instruction implies a copy change.
     */
    regenerationIntent: z
      .enum(['copy', 'image', 'branding', 'full'])
      .optional(),
    /** Tag for async WhatsApp delivery on completion (mirrors video pipeline). */
    whatsappDelivery: z
      .object({
        conversationId: z.string().min(1),
        userId: z.string().min(1),
      })
      .optional(),
  })
  .superRefine((input, ctx) => {
    if (
      input.scope === 'slide' &&
      input.sourceAssetIds &&
      input.sourceAssetIds.length !== 1
    ) {
      ctx.addIssue({
        code: 'custom',
        path: ['sourceAssetIds'],
        message: 'Slide regeneration accepts exactly one source image',
      });
    }
  });

export type RegenerateGraphicInput = z.infer<typeof regenerateGraphicSchema>;
