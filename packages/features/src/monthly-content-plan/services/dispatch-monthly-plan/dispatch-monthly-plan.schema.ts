import { graphicCategoryValues } from '@borradh-workspace/labels';
import { z } from 'zod';

const plannedContentItemSchema = z.object({
  kind: z.enum(['video', 'carousel', 'single']),
  /**
   * Optional editorial category for image items (`carousel` | `single`).
   * The monthly content planner doesn't pick categories yet — when absent
   * the dispatcher defaults to `'tips'` before invoking the image-detail
   * planner. Ignored for `'video'` items.
   */
  category: z.enum(graphicCategoryValues).optional(),
  targetServiceId: z.string().min(1),
  topicSummary: z.string().min(1),
  rationale: z.string().min(1),
});

const monthlyContentPlanSchema = z.object({
  organizationId: z.string().min(1),
  periodMonth: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/),
  items: z.array(plannedContentItemSchema),
});

/**
 * Input to `dispatchMonthlyPlan`.
 *
 * The dispatcher takes a `MonthlyContentPlan` (from `planMonthlyContent`)
 * plus the wiring metadata each modality-specific detail planner needs
 * but can't derive from the plan alone:
 *
 *   - `batchId` / `createdById` — the `content_batch` row the items
 *     belong to (the caller — typically `runMonthlyBatchesCron` — creates
 *     the batch first, then calls the planner, then the dispatcher).
 *   - `videoSchedules` — UTC `Date`s the resulting video posts should
 *     publish at. One per video item in the plan, in plan order. Image
 *     items don't currently carry a `scheduledAt` because their
 *     rendering is batch-API async; the materialise step will assign
 *     positions and (optionally) schedule them when the renders land.
 *   - `targetPageIds` — meta_ads_page.id[] to cross-post videos to.
 *     Empty array is fine; the review dialog can edit before accept.
 *   - `cdnUrl` — used by `planVideoDetail` to resolve template music
 *     track paths into absolute URLs.
 *   - `videoPositionOffset` / `graphicPositionOffset` — where in the
 *     batch's existing range to start counting. Defaults to 0 (fresh
 *     batch); the cron passes 0, the in-app "Generate more" button
 *     passes the appropriate offsets.
 */
export const dispatchMonthlyPlanSchema = z.object({
  plan: monthlyContentPlanSchema,
  batchId: z.string().min(1, 'batchId is required'),
  createdById: z.string().min(1, 'createdById is required'),

  // One Date per video item in plan order. The dispatcher will reject if
  // the length doesn't match the video count.
  videoSchedules: z.array(z.date()),

  targetPageIds: z.array(z.string()).default([]),
  cdnUrl: z.string().url().optional(),

  videoPositionOffset: z.number().int().min(0).default(0),
  graphicPositionOffset: z.number().int().min(0).default(0),

  /** Whether video detail planning may fill missing service footage with stock. */
  allowStockFootage: z.boolean().optional().default(true),
});

export type DispatchMonthlyPlanInput = z.input<
  typeof dispatchMonthlyPlanSchema
>;
