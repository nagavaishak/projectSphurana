import { z } from 'zod';

/**
 * How far back the very first poll for a page reaches.
 *
 * Meta keeps lead data for 90 days, so this is the widest useful window.
 *
 * This is also, deliberately, the ONBOARDING behaviour: a page connected for
 * the first time has a null `lastLeadPollAt`, so its first poll imports the
 * clinic's previous 90 days of Meta leads. A new customer arrives with their
 * lead history already in place instead of an empty list.
 *
 * Those historical leads are data only — they are outside the activation
 * window, so no opener, no sequence, no notification. Nothing about connecting
 * an account may message a member of the public.
 *
 * Load-bearing consequence: `last_lead_poll_at` must have NO column default.
 * Seeding it on insert would silently turn the onboarding import off, and
 * nothing else would fail.
 */
export const DEFAULT_INITIAL_LOOKBACK_DAYS = 90;

/**
 * Leads older than this are ingested for their data only — no Claire opener,
 * no sequence auto-start. A backfill must never cold-message someone who
 * filled a form weeks ago.
 */
export const DEFAULT_ACTIVATION_WINDOW_MINUTES = 60;

export const pollMetaLeadFormsSchema = z.object({
  /** Limit the run to one organization (used by the manual backfill path). */
  organizationId: z.string().optional(),
  /** Limit the run to one Facebook page id. */
  pageId: z.string().optional(),
  /** Lookback used when a page has no cursor yet. */
  initialLookbackDays: z
    .number()
    .int()
    .positive()
    .max(90)
    .default(DEFAULT_INITIAL_LOOKBACK_DAYS),
  /**
   * Age below which a recovered lead still triggers Claire's opener and any
   * matched sequence. Set to 0 to ingest data only.
   */
  activationWindowMinutes: z
    .number()
    .int()
    .min(0)
    .default(DEFAULT_ACTIVATION_WINDOW_MINUTES),
  /**
   * Send Claire's opener to RECOVERED leads too — people who submitted a form
   * and, because Meta never delivered the webhook, got total silence.
   *
   * Off by default so the scheduled poll never surprises anyone. The safety
   * rules are not weakened by this: `sendLeadFirstTouch` still refuses when the
   * lead already has a conversation (`already_contacted`), when consent or
   * suppression says no, or when no channel can hold the reply. This only
   * widens WHO is considered.
   *
   * Note it does NOT auto-start sequences or fire push notifications for stale
   * leads — one opener, not a campaign.
   */
  contactRecovered: z.boolean().default(false),
  /**
   * Spacing between recovered-lead openers, in ms. Recovering 90 days at once
   * can create hundreds of leads; firing their openers in one burst trips
   * provider rate limits and lands every reply on the clinic simultaneously.
   */
  contactStaggerMs: z.number().int().min(0).default(15_000),
  /**
   * Read ARCHIVED lead forms too.
   *
   * An archived form still holds its history, and a campaign that has since
   * ended is exactly the case a recovery run needs — so a backfill MUST set
   * this. It defaults to false only so the steady-state poll does not keep
   * paying for forms that can no longer take leads.
   *
   * This is explicit rather than inferred from "the cursor is null": the
   * recovery script rewinds the cursor to a real date before reconciling, so
   * any null-cursor heuristic reads false there and would silently skip the
   * archived-form leads the run exists to recover — while still reporting
   * success. The dry-run survey reads all forms unconditionally, so inferring
   * would also make the preview disagree with what --write imports.
   */
  includeArchivedForms: z.boolean().default(false),
  /** Safety cap on pages processed in a single run. */
  maxPages: z.number().int().positive().default(500),
});

export type PollMetaLeadFormsInput = z.input<typeof pollMetaLeadFormsSchema>;
