import { listMetaCampaignsResponseSchema } from '@borradh-workspace/contracts';
import { z } from 'zod';
import { ApiFetchError, defineTool } from '../../tool-factory/index.js';

/**
 * One campaign row as reported to the model.
 *
 * `dailyBudget` / `lifetimeBudget` are Meta's raw budget STRINGS in the ad
 * account's minor units (e.g. `"1500"` = €15.00), not numbers — see
 * `MetaCampaignData` in `@borradh-workspace/integrations/meta-ads`, whose
 * fields `listCampaigns` spreads verbatim. This tool used to declare them
 * `number | null`; the wire value never changed, only the (false) type did.
 */
interface CampaignSummary {
  id: string;
  name: string;
  objective: string;
  status: string;
  dailyBudget: string | null;
  lifetimeBudget: string | null;
  adCount: number;
}

interface ListCampaignsOutput {
  campaigns: CampaignSummary[];
  total: number;
  error?: string;
}

/**
 * `meta_ads_listCampaigns` — list Meta campaigns for the org.
 *
 * Ported from the legacy `listCampaigns` tool (`ad-tools.ts`). Read-only;
 * preserves the legacy soft-failure shape ({ error }) on apiFetch failure.
 */
export const listCampaignsTool = defineTool<
  Record<string, never>,
  ListCampaignsOutput
>({
  feature: 'meta-ads',
  action: 'listCampaigns',
  description:
    'List all Meta Ads campaigns for the organization. Returns campaign name, ' +
    'objective, status, budget, and ad count. Use this to show the user their ' +
    'campaigns or to find which campaign to add an ad to.',
  inputSchema: z.object({}),
  destructive: false,
  preferredModel: 'sonnet',
  presentation: { statusLabel: 'Listing campaigns' },
  execute: async (_input, ctx) => {
    try {
      const data = await ctx.apiFetch('meta-campaigns', {
        schema: listMetaCampaignsResponseSchema,
      });

      return {
        data: {
          campaigns: data.campaigns.map((c) => ({
            id: c.id,
            name: c.name,
            objective: c.objective,
            status: c.status,
            dailyBudget: c.dailyBudget ?? null,
            lifetimeBudget: c.lifetimeBudget ?? null,
            adCount: c.adCount,
          })),
          total: data.campaigns.length,
        },
      };
    } catch (error) {
      const isExpectedClientError =
        error instanceof ApiFetchError &&
        error.status >= 400 &&
        error.status < 500;
      if (!isExpectedClientError) {
        ctx.reportIssue('Failed to list campaigns', { error });
      }
      return {
        data: {
          campaigns: [],
          total: 0,
          error:
            error instanceof Error
              ? error.message
              : 'Failed to list campaigns.',
        },
      };
    }
  },
});
