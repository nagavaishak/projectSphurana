import { z } from 'zod';

const IS_DEV = process.env.NODE_ENV === 'development';

/**
 * Slots seeded per modality in a full monthly batch. Product calls for six
 * graphics and two videos — the modalities are NOT symmetric: a graphic slot
 * is one image-model call, a video slot is a full render, so the batch is
 * deliberately graphic-heavy.
 *
 * Local development halves it: three graphics and one video. Every slot
 * renders a real video or calls a real image model, and nobody running the API
 * on their laptop needs the full mix to exercise the pipeline. Only `NODE_ENV`
 * `development` is reduced — `test` keeps the product numbers so the suites
 * assert them, and preview/staging/production run `production`.
 *
 * The frontend's requested mix (`create-batch-dialog.tsx`) mirrors these with
 * `import.meta.env.DEV`; they must move together, because the dialog shows the
 * owner the numbers it is about to request.
 */
export const DEFAULT_BATCH_GRAPHIC_COUNT = IS_DEV ? 3 : 6;
export const DEFAULT_BATCH_VIDEO_COUNT = IS_DEV ? 1 : 2;

export const generateMonthlyBatchSchema = z.object({
  organizationId: z.string().min(1, 'Organization ID is required'),

  // Period this batch covers, formatted YYYY-MM. Defaults to the current
  // month in UTC if omitted. Allowing the caller to override is what makes
  // the operation testable and lets a backfill script ask for prior
  // months. The cron always passes the current month explicitly.
  periodMonth: z
    .string()
    .regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'periodMonth must be YYYY-MM')
    .optional(),

  // How many graphic items to seed per batch. Kept configurable so the same
  // code path covers a one-off small batch from a smoke test without needing
  // a separate service.
  graphicCount: z
    .number()
    .int()
    .min(0)
    .max(10)
    .default(DEFAULT_BATCH_GRAPHIC_COUNT),

  // How many video items to seed per batch. The service emits a warning and
  // skips video seeding when count > 0 but no templates qualify. See
  // `feedback_no_stubs_full_ports` — we don't fake video items.
  videoCount: z
    .number()
    .int()
    .min(0)
    .max(10)
    .default(DEFAULT_BATCH_VIDEO_COUNT),

  // User the items should be attributed to. Required because `video.createdById`
  // is non-null. The cron passes an organization owner / system user picked
  // by the caller.
  createdById: z.string().min(1, 'createdById is required'),

  // When true, seed fresh items INTO the existing month's batch instead of
  // no-opping. The manual "Create Batch" button sets this so re-clicking
  // tops the batch up with more content to review. Optional (not defaulted)
  // so the cron can omit it; treated as falsy to preserve idempotency — a
  // repeat monthly run must never double-seed.
  append: z.boolean().optional(),

  // When true, CLEAR the existing month's batch before seeding — delete every
  // pending item (and its referenced video/graphic rows) so a fresh batch
  // replaces whatever was queued. The manual "Create Batch" button sets this
  // so each click wipes the review queue and regenerates from scratch. Takes
  // precedence over `append`. Optional + undefaulted so the cron stays
  // idempotent.
  replace: z.boolean().optional(),

  // Restrict the month's content to these services only. When omitted, the
  // planner considers ALL active services (the cron / smoke-test behaviour).
  // The manual "Create Batch" dialog passes the user's chosen services so the
  // batch covers exactly what they selected — a hard filter, not a hint.
  serviceIds: z.array(z.string().min(1)).min(1).optional(),

  // Uploaded, render-ready clips always take priority; when a selected service
  // has none, videos are filled from the curated stock bank. Default-on so a
  // no-media org (e.g. the onboarding "use stock" choice) still gets a batch;
  // cron/automation and the planner checkbox pass an explicit value.
  allowStockFootage: z.boolean().optional().default(true),
});

/** Caller-facing input: fields with a schema default may be omitted. */
export type GenerateMonthlyBatchInput = z.input<
  typeof generateMonthlyBatchSchema
>;

/**
 * Post-parse shape: schema defaults are applied, so defaulted fields
 * (`allowStockFootage`, `graphicCount`, `videoCount`) are always present.
 * Internal helpers that run after `safeParse` should use this.
 */
export type GenerateMonthlyBatchParsed = z.output<
  typeof generateMonthlyBatchSchema
>;
