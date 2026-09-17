import { type LeadStats, leadStatsSchema } from '@borradh-workspace/contracts';
import { z } from 'zod';
import { defineTool } from '../../tool-factory/index.js';

/**
 * `leads_getLeadStats` — aggregate counts across the organisation's lead
 * pipeline.
 *
 * Read-only. Backed by `GET /leads/stats`. Use this for "how are my leads
 * doing" / "what's my conversion rate" type questions; for time-windowed
 * comparisons use `leads_summariseRecentLeads`.
 */
export const getLeadStatsTool = defineTool<Record<string, never>, LeadStats>({
  feature: 'leads',
  action: 'getLeadStats',
  description:
    'Aggregate lead counts across the organisation: total, by status ' +
    '(new/contacted/booked/lost), and overall conversion rate. ' +
    'For time-windowed comparisons use `leads_summariseRecentLeads`.',
  inputSchema: z.object({}),
  destructive: false,
  preferredModel: 'sonnet',
  presentation: { statusLabel: 'Reading lead stats' },
  additionalAllowedPaths: [/^leads\/stats$/],
  execute: async (_input, ctx) => {
    const data = await ctx.apiFetch('leads/stats', {
      schema: leadStatsSchema,
    });
    return { data };
  },
});
