import { z } from 'zod';

/**
 * Input to `planVideoDetail`.
 *
 * The unified monthly topic planner (in `monthly-content-plan`) picks the
 * service + topic and the dispatcher fans each item out to this service for
 * the modality-specific work (script + scene plan + render queueing).
 *
 * `templateId` / `variationId` are optional — when omitted the service picks
 * deterministically from the organic-templates registry. The dispatcher may
 * still want to pass them in to keep behaviour reproducible across runs.
 *
 * `scheduledAt` is the wall-clock UTC time the resulting `social_post` should
 * publish. The dispatcher computes this from the batch's even-cadence date
 * spread; the legacy `build-batch-plan` helper is one source.
 *
 * `targetPageIds` defaults at plan time to every connected FB+IG page; the
 * review dialog can edit them before accept.
 */
export const planVideoDetailSchema = z.object({
  organizationId: z.string().min(1, 'Organization ID is required'),
  createdById: z.string().min(1, 'createdById is required'),
  batchId: z.string().min(1, 'batchId is required'),

  // YYYY-MM. Carried through for `social_post` scheduling + title fallbacks.
  periodMonth: z
    .string()
    .regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'periodMonth must be YYYY-MM'),

  // Service this slot was planned around — chosen upstream by the unified
  // topic planner. The on-screen copy + script are built around it.
  targetServiceId: z.string().min(1, 'targetServiceId is required'),

  // Short topic description from the unified topic planner. Not currently
  // persisted (the `content_batch_item.topic_summary` column was dropped in
  // migration 0038) and not fed into the per-slot video idea generator
  // today (that uses the structured `getOrgContext`). Kept on the input
  // contract so future iterations can bias the idea prompt by it without
  // a dispatcher change.
  topicSummary: z.string().min(1, 'topicSummary is required'),

  // 0-indexed position within the batch (videos only — graphics have their
  // own range).
  position: z.number().int().min(0),

  // UTC time the resulting social post should publish.
  scheduledAt: z.date(),

  // Optional template + variation override. Pinned by the dispatcher when
  // it wants reproducibility; otherwise the service picks the first organic
  // template and its first variation.
  templateId: z.string().optional(),
  variationId: z.string().optional(),

  // meta_ads_page.id[] to cross-post this slot to. Empty array is allowed —
  // the review dialog can fill them in before accept.
  targetPageIds: z.array(z.string()).default([]),

  // Used to prefix template music track paths into CDN-resolvable URLs.
  // Required if the chosen template ships a music track. Pass `undefined`
  // to skip music.
  cdnUrl: z.string().url().optional(),

  /**
   * Allow this slot to fall back to AI-matched curated stock b-roll when the
   * target service has no uploaded video footage.
   */
  allowStockFootage: z.boolean().optional().default(true),

  /**
   * Set when this is a RE-ROLL of an existing post (the review-thread
   * regenerate). Drives refinement-aware copy generation and tells the insert
   * to append a cut rather than create a post. When present:
   *   - on-screen copy regenerates from `priorCopy` applying
   *     `refinementInstruction`;
   *   - a new `content_batch_attempt` is appended to `slotId` at
   *     `attemptNumber`, and the slot's pointer moves to it;
   *   - the slot keeps its id, decision, schedule and conversation, so the
   *     owner's review edits and thread survive the re-roll.
   */
  regeneration: z
    .object({
      /**
       * The SLOT being re-rolled. Was `previousItemId` — the row the new item
       * superseded — back when a regenerate minted a whole new post. It names a
       * post now, not a predecessor, which is the entire point of the change.
       */
      slotId: z.string().min(1),
      /** Position of the new cut in the slot's history. `attempts` so far. */
      attemptNumber: z.number().int().min(0),
      regenerationCount: z.number().int().min(0),
      refinementInstruction: z.string().max(500).optional(),
      priorCopy: z.record(z.string(), z.unknown()).optional(),
      reuseCaption: z.string().nullable().optional(),
      reuseVideoIdea: z.record(z.string(), z.unknown()).nullable().optional(),

      /**
       * What this regeneration is changing — see `videos/regeneration-intent.ts`.
       * Declared rather than inferred so tuning one intent cannot silently
       * disable another. Omitted, the planner infers it (compatibility shim).
       */
      intent: z.enum(['copy', 'footage', 'full']).optional(),

      /**
       * The clip asset ids the PREVIOUS render used, in order.
       *
       * Without these a copy edit cannot keep its footage: selection is a
       * least-recently-used claim that stamps `lastUsedAt` as it claims, so
       * re-claiming is actively steered away from the clips just used. Carrying
       * them is what makes "make the headline shorter" return the same video
       * with a shorter headline.
       */
      priorClipAssetIds: z.array(z.string().min(1)).optional(),
    })
    .optional(),
});

export type PlanVideoDetailInput = z.input<typeof planVideoDetailSchema>;
