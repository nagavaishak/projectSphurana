import { z } from 'zod';
import { defineTool } from '../../tool-factory/index.js';

const safeExternalId = z.string().regex(/^[\w-]+$/, 'Invalid ID format');

/**
 * Shape returned by `GET meta-campaigns/:id/diagnose` — mirrors the
 * `CampaignDiagnosis` from `@borradh-workspace/features/meta-campaigns`.
 */
interface CampaignDiagnosisApiResponse {
  metaCampaignId: string;
  windowDays: number;
  spendCents: number;
  spendUsdCents: number;
  currency: string | null;
  spentEnough: boolean;
  spendThresholdEur: number;
  highIntentLeadCount: number;
  daysSinceLastHighIntentLead: number | null;
  serviceTier: 1 | 2 | 3 | null;
  offerStrategy: string | null;
  budgetBand: 'below_10' | '10_to_19' | '20_plus' | null;
  avgDailySpendCents: number | null;
  currentRound: 'none' | 'offer_adjusted' | 'creative_refreshed';
  roundsTried: number;
  escalated: boolean;
  lastDiagnosedAt: string | null;
}

type DiagnoseCampaignOutput =
  | CampaignDiagnosisApiResponse
  | { metaCampaignId: string; error: string };

/**
 * `meta_ads_diagnoseCampaign` — deterministic campaign troubleshooting
 * diagnosis (PRD-1 Task 3). Keeps the LLM out of the arithmetic: spend gate,
 * high-intent lead stats, service tier (from the org's data-derived
 * offerStrategy), budget band, and lifecycle round/escalation state all come
 * back computed. Read-only; the troubleshoot skill reads this before saying
 * anything about a campaign that "isn't working".
 */
export const diagnoseCampaignTool = defineTool<
  { metaCampaignId: string; windowDays?: number },
  DiagnoseCampaignOutput
>({
  feature: 'meta-ads',
  action: 'diagnoseCampaign',
  description:
    'Diagnose why a Meta campaign may be underperforming. Returns whether it ' +
    'has spent enough to judge (€80 gate), how many high-intent leads it has ' +
    'produced and how long since the last one, the service tier (from the ' +
    "org's offer strategy), the budget band, and how many troubleshooting " +
    'rounds have already been tried (offer adjustment → creative refresh → ' +
    'escalation). Call this FIRST whenever an owner says a campaign "isn\'t ' +
    'working" or they\'ve had "zero bookings" — check the real data before ' +
    'responding.',
  inputSchema: z.object({
    metaCampaignId: safeExternalId.describe('The Meta campaign ID to diagnose'),
    windowDays: z
      .number()
      .int()
      .positive()
      .max(365)
      .optional()
      .describe('Look-back window for spend aggregation (defaults to 30 days)'),
  }),
  destructive: false,
  preferredModel: 'opus',
  presentation: { statusLabel: 'Diagnosing campaign' },
  execute: async ({ metaCampaignId, windowDays }, ctx) => {
    try {
      const params = new URLSearchParams();
      if (windowDays != null) params.set('windowDays', String(windowDays));
      const qs = params.toString();

      const data = await ctx.apiFetch<CampaignDiagnosisApiResponse>(
        `meta-campaigns/${metaCampaignId}/diagnose${qs ? `?${qs}` : ''}`
      );

      return { data };
    } catch (error) {
      return {
        data: {
          metaCampaignId,
          error:
            error instanceof Error
              ? error.message
              : 'Failed to diagnose campaign.',
        },
      };
    }
  },
});
