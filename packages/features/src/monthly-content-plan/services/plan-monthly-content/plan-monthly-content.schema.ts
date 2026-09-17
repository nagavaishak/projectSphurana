import { z } from 'zod';

/**
 * Input to `planMonthlyContent`. The unified topic planner produces a
 * 12-item plan for one org for one month — 4 videos + 4 carousels + 4
 * singles. The dispatcher fans the items out to modality-specific
 * detail planners.
 */
export const planMonthlyContentSchema = z.object({
  organizationId: z.string().min(1, 'Organization ID is required'),

  /** YYYY-MM. Caller passes the period explicitly so the cron is testable. */
  periodMonth: z
    .string()
    .regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'periodMonth must be YYYY-MM'),

  /** How many of each modality to emit. Product calls for 4 each. */
  videoCount: z.number().int().min(0).max(10).default(4),
  carouselCount: z.number().int().min(0).max(10).default(4),
  singleCount: z.number().int().min(0).max(10).default(4),

  /**
   * Look-back window in days for dedup-by-topic. The planner asks Claude
   * to avoid recently-used topics, which keeps the monthly mix fresh.
   * 60 days = roughly two prior batches.
   */
  recentTopicsLookbackDays: z.number().int().min(0).max(180).default(60),

  /**
   * Restrict candidate services to this set (a hard filter intersected with
   * the org's active services). When omitted, ALL active services are
   * candidates — the cron / smoke-test behaviour. The manual "Create Batch"
   * dialog passes the user's chosen services.
   */
  serviceIds: z.array(z.string().min(1)).optional(),

  /**
   * When true, video items may target services without uploaded clips because
   * `planVideoDetail` can AI-match curated stock b-roll for them. When false,
   * videos require the selected service's own uploaded footage.
   */
  allowStockFootage: z.boolean().optional().default(true),
});

export type PlanMonthlyContentInput = z.input<typeof planMonthlyContentSchema>;

/**
 * Zod schema for Claude's structured output. The model must emit an item
 * for every (kind, position) slot — the service then validates counts,
 * service IDs, and topic uniqueness against the look-back set.
 *
 * `targetServiceId` is the org-scoped service.id — Claude is given the
 * candidate list in the prompt and may only pick from it.
 */
export const plannedContentItemSchema = z.object({
  kind: z.enum(['video', 'carousel', 'single']),
  targetServiceId: z.string().min(1),
  topicSummary: z.string().min(1).max(280),
  rationale: z.string().min(1).max(280),
});

export const claudeMonthlyPlanSchema = z.object({
  items: z.array(plannedContentItemSchema),
});

export type ClaudeMonthlyPlan = z.infer<typeof claudeMonthlyPlanSchema>;
