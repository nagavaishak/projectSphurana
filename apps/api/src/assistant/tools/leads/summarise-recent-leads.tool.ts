import {
  type LeadSummaryResponse,
  leadSummaryResponseSchema,
} from '@borradh-workspace/contracts';
import { z } from 'zod';
import { defineTool } from '../../tool-factory/index.js';

const summariseRecentLeadsInputSchema = z.object({
  timeframe: z
    .enum(['today', 'week', 'month'])
    .default('week')
    .describe('Window to summarise. Defaults to the last 7 days.'),
  limit: z
    .number()
    .int()
    .positive()
    .max(20)
    .default(5)
    .describe('How many top leads to surface in the summary. Default 5.'),
});

/**
 * `leads_summariseRecentLeads` — structured rollup for "how are my leads
 * doing this week / today / this month".
 *
 * Read-only. Backed by `GET /leads/summary`. Returns counts, by-status and
 * by-source breakdowns, a deltaPercent vs the equal-duration prior window,
 * plus a `limit` slice of the most-recent leads. The model formats this
 * into prose; the service stays deterministic.
 */
export const summariseRecentLeadsTool = defineTool<
  z.infer<typeof summariseRecentLeadsInputSchema>,
  LeadSummaryResponse
>({
  feature: 'leads',
  action: 'summariseRecentLeads',
  description:
    'Summarise leads in a recent window (today/week/month). Returns total ' +
    'count, by-status and by-source breakdowns, a deltaPercent against the ' +
    'preceding equal-duration window, and the top N most-recent leads (name ' +
    '+ status + source + createdAt). The caller writes the prose summary ' +
    'using this structured data.',
  inputSchema: summariseRecentLeadsInputSchema,
  destructive: false,
  preferredModel: 'sonnet',
  presentation: { statusLabel: 'Summarising leads' },
  additionalAllowedPaths: [/^leads\/summary$/],
  execute: async (input, ctx) => {
    const params = new URLSearchParams({
      timeframe: input.timeframe,
      limit: String(input.limit),
    });
    const data = await ctx.apiFetch(`leads/summary?${params.toString()}`, {
      schema: leadSummaryResponseSchema,
    });
    return { data };
  },
});
