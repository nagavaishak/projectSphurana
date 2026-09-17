import { z } from 'zod';

/**
 * Look-back window for spend/insight aggregation. Defaults to 30 days.
 *
 * Arrives as a raw query-string value over HTTP, so the parse belongs here and
 * not in the controller. The transform reproduces exactly the controller's old
 * `Number.parseInt(windowDays, 10)` + "forward it only when truthy and not NaN"
 * step, so an unparseable or zero window still falls back to the default rather
 * than failing validation. Out-of-range values still fail, as they did before.
 */
const windowDaysField = z
  .union([z.string(), z.number()])
  .optional()
  .transform((value) => {
    if (typeof value !== 'string') return value;
    const parsed = Number.parseInt(value, 10);
    return parsed && !Number.isNaN(parsed) ? parsed : undefined;
  })
  .pipe(z.number().int().positive().max(365).optional());

export const diagnoseCampaignSchema = z.object({
  organizationId: z.string().min(1, 'Organization ID is required'),
  metaCampaignId: z.string().min(1, 'Campaign ID is required'),
  windowDays: windowDaysField,
});

/**
 * Input accepted by `diagnoseCampaign` — `z.input` (not `z.infer`) so a caller
 * may hand `windowDays` over as the raw query-string value.
 */
export type DiagnoseCampaignInput = z.input<typeof diagnoseCampaignSchema>;

export type ServiceTier = 1 | 2 | 3;
export type BudgetBand = 'below_10' | '10_to_19' | '20_plus';

/**
 * Deterministic diagnosis the LLM reads but never computes (PRD-1 Task 3).
 * Money is in cents of the original billing currency unless suffixed `Usd`.
 */
export interface CampaignDiagnosis {
  metaCampaignId: string;
  windowDays: number;

  // Spend (framework Step 1).
  spendCents: number;
  spendUsdCents: number;
  currency: string | null;
  spentEnough: boolean;
  spendThresholdEur: number;

  // High-intent leads (framework Step 2), shared predicate.
  highIntentLeadCount: number;
  daysSinceLastHighIntentLead: number | null;

  // Service tier — derived from the org's data-driven offerStrategy, NOT a new
  // column. The data-derived strategy wins over the doc's hardcoded tiers.
  serviceTier: ServiceTier | null;
  offerStrategy: string | null;

  // Budget band — derived from observed average daily spend (the configured
  // daily budget is not synced locally). Owner always decides budget.
  budgetBand: BudgetBand | null;
  avgDailySpendCents: number | null;

  // Lifecycle (Task 2 state).
  currentRound: 'none' | 'offer_adjusted' | 'creative_refreshed';
  roundsTried: number;
  escalated: boolean;
  lastDiagnosedAt: string | null;
}
