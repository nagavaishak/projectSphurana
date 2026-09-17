import { graphicCategoryValues } from '@borradh-workspace/labels';
import { z } from 'zod';

/**
 * Queue + DLQ for the branded-graphic (nano-banana / Gemini) generate
 * pipeline. Consumed by `apps/video-worker/src/graphic-generate-processor.ts`.
 *
 * Fed by:
 *   1. The socials "Generate Graphic" flow (single click → one job)
 *   2. The monthly bulk content generator (one job per planned graphic)
 *   3. Regenerate (re-roll an existing batch item's graphic)
 */
export const GRAPHIC_GENERATE_QUEUE = 'graphic-generate';
export const GRAPHIC_GENERATE_DLQ = 'graphic-generate-dlq';

/**
 * Socials path: server has {serviceId, category, kind, topic}. The worker
 * generates a single graphic (or a coherent carousel) from the org's real
 * service media + brand corpus.
 */
/**
 * When present, the graphic worker delivers the finished image(s) to the
 * owner's WhatsApp conversation on completion — mirrors the video pipeline's
 * `whatsappDelivery` tag.
 */
const whatsappDeliverySchema = z
  .object({
    conversationId: z.string().min(1),
    userId: z.string().min(1),
  })
  .optional();

const planAndRenderJobSchema = z.object({
  mode: z.literal('plan-and-render'),
  graphicId: z.string().min(1, 'graphicId required'),
  organizationId: z.string().min(1, 'organizationId required'),
  serviceId: z.string().min(1, 'serviceId required'),
  kind: z.enum(['single', 'carousel']),
  category: z.enum(graphicCategoryValues),
  topicSummary: z.string(),
  brandPrimaryColor: z.string().min(1),
  /**
   * Whether AI image generation may fill slots with no matching service
   * media. Defaults false — graphics use the service's uploaded media only.
   * Set true only when the user explicitly opted into AI in the dialog.
   */
  allowAiImages: z.boolean().default(false),
  /** Uploaded subject images explicitly chosen before generation. */
  sourceAssetIds: z.array(z.string().min(1)).min(1).max(10).optional(),
  /**
   * Whether the curated stock-image tier may fill slots with no matching
   * service media. Defaults true — only an explicit false (the user turning off
   * "Use curated stock photos") disables it.
   */
  allowStockImages: z.boolean().default(true),
  /**
   * organic = social post (default), ad = paid offer ad. Drives which template
   * pool the worker selects from and whether offer copy is composed.
   */
  usageType: z.enum(['organic', 'ad']).default('organic'),
  /** Required when usageType='ad' — the offer the ad promotes. */
  offerId: z.string().min(1).optional(),
  /**
   * Free-text user instruction to steer generation (e.g. "make it brighter",
   * "lead with the price"). On the create-post path this is first-gen guidance
   * — there is no prior render to anchor against. Threaded into the copy writer
   * + image prompt.
   */
  refinementInstruction: z.string().max(500).optional(),
  /**
   * Curated template slug to render against, chosen by the user (the dialog's
   * style picker) or Claire's `style` param. When absent the worker selects
   * deterministically by hashing the graphicId.
   */
  templateSlug: z.string().optional(),
  whatsappDelivery: whatsappDeliverySchema,
});

/**
 * Bulk / regenerate path: the graphic row + content_batch_item already exist;
 * the job carries the service + topic the worker renders from. Same engine as
 * plan-and-render — generates from the org's real service media + brand
 * corpus.
 */
const renderOnlyJobSchema = z.object({
  mode: z.literal('render-only'),
  graphicId: z.string().min(1, 'graphicId required'),
  organizationId: z.string().min(1, 'organizationId required'),
  contentBatchId: z.string().min(1).optional(),
  serviceId: z.string().min(1, 'serviceId required'),
  topicSummary: z.string().min(1, 'topicSummary required'),
  brandPrimaryColor: z.string().min(1),
  allowAiImages: z.boolean().optional(),
  sourceAssetIds: z.array(z.string().min(1)).min(1).max(10).optional(),
  usageType: z.enum(['organic', 'ad']).optional(),
  offerId: z.string().min(1).optional(),
  /**
   * Whether the curated stock-image tier may fill slots with no matching
   * service media. Optional like `allowAiImages` above: callers that omit it
   * (monthly-batch, regenerate) leave it undefined and the worker coalesces to
   * `true` (`allowStockImages ?? true`), so stock stays on by default — only an
   * explicit `false` (user turned the toggle off) disables it.
   */
  allowStockImages: z.boolean().optional(),
  /** single vs carousel — lets the engine orchestrate a coherent multi-slide
   *  set for bulk carousels. Defaults to single when absent. */
  kind: z.enum(['single', 'carousel']).optional(),
  /**
   * Free-text user instruction captured in the batch-review dialog when the
   * user re-rolls an item ("not on brand", "use the second photo", "warmer
   * tone"). Threaded into the copy writer + image prompt.
   */
  refinementInstruction: z.string().max(500).optional(),
  /**
   * URL of the PREVIOUS render of this graphic (its first output slide).
   * Refinement-aware regeneration: the worker fetches it and passes it to the
   * model as a reference labelled "the previous version" so the change applies
   * surgically instead of re-rolling from scratch. Single graphics only.
   */
  priorImageUrl: z.string().url().optional(),

  /**
   * The copy currently rendered on the graphic being regenerated.
   *
   * Copy is written fresh by Claude on every render and Gemini transcribes
   * whatever string it is given, so without the previous text a request to
   * change the headline also reissued the body and the CTA. Carrying it lets
   * the copy writer perform a surgical edit instead.
   */
  priorCopy: z.string().optional(),

  /**
   * What this regeneration is changing — see `regeneration-intent.ts`.
   * Declared rather than inferred so tuning one intent cannot silently
   * disable another.
   */
  regenerationIntent: z.enum(['copy', 'image', 'branding', 'full']).optional(),
  /**
   * The curated template slug to render against. Pinned on a regenerate so the
   * design doesn't drift to a different template (template selection otherwise
   * hashes the fresh graphicId). When absent the worker selects deterministically.
   */
  templateSlug: z.string().optional(),
  /**
   * TARGETED carousel refine: which slides to re-render, and what to tell the
   * model about each. Every slide NOT named here is copied across verbatim from
   * `priorGraphicId`.
   *
   * A LIST rather than one index because the deck refiner already runs one
   * model call per slide, so "slide 1 says A, slide 2 says B" is a single job
   * at the same cost as refining the whole deck — the only thing that was ever
   * shared was one instruction string. One entry expresses the single-slide
   * re-roll this replaced.
   *
   * Absent = the whole graphic re-renders, using `refinementInstruction` for
   * every slide.
   */
  slideInstructions: z
    .array(
      z.object({
        slideIndex: z.number().int().min(0),
        /**
         * `refine` re-renders the slide from its own prior image with `note`.
         * `remove` drops it from the deck — no model call, since the remaining
         * slides are already-rendered PNGs that are simply carried across.
         */
        op: z.enum(['refine', 'remove']).default('refine'),
        note: z.string().max(280).optional(),
      })
    )
    .min(1)
    .max(10)
    .optional(),
  /**
   * The graphic whose existing `outputs[]` are preserved on a targeted refine
   * (every slide not in `slideInstructions` is copied across verbatim), and
   * which each refined slide is anchored to.
   */
  priorGraphicId: z.string().optional(),
  whatsappDelivery: whatsappDeliverySchema,
});

export const queueGraphicGenerateSchema = z.discriminatedUnion('mode', [
  planAndRenderJobSchema,
  renderOnlyJobSchema,
]);

export type QueueGraphicGenerateInput = z.infer<
  typeof queueGraphicGenerateSchema
>;

export type GraphicGenerateJobPayload = QueueGraphicGenerateInput;
