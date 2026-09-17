import { messagingCampaignListResponseSchema } from '@borradh-workspace/contracts';
import { z } from 'zod';
import { defineTool } from '../../tool-factory/index.js';

const campaignStatusValues = [
  'draft',
  'scheduled',
  'sending',
  'paused',
  'sent',
  'failed',
  'cancelled',
] as const;

const listCampaignsInputSchema = z.object({
  status: z
    .enum(campaignStatusValues)
    .optional()
    .describe('Filter by campaign status (e.g. draft, scheduled, sent).'),
  limit: z
    .number()
    .int()
    .positive()
    .max(100)
    .default(50)
    .describe('Page size, capped at 100. Default 50.'),
  offset: z
    .number()
    .int()
    .nonnegative()
    .default(0)
    .describe('Pagination offset. Use to fetch the next page.'),
});

interface ListCampaignsOutput {
  campaigns: Array<{
    id: string;
    name: string;
    status: string;
    channels: string[];
    segmentId: string | null;
    scheduledAt: string | null;
  }>;
  pageCount: number;
  limit: number;
  offset: number;
}

/**
 * `campaigns_list` — list the active organization's messaging campaigns.
 *
 * Read-only. Backed by `GET /campaigns`. Messaging campaigns are bulk
 * SMS / email / WhatsApp sends to an audience segment (distinct from Meta Ads
 * campaigns, which are handled by the `meta-ads` tools). The model uses this
 * for "show me my campaigns" / "which campaigns are still drafts" asks. The
 * `pageCount` is the size of THIS page slice, not an absolute total.
 */
export const listCampaignsTool = defineTool<
  z.infer<typeof listCampaignsInputSchema>,
  ListCampaignsOutput
>({
  feature: 'campaigns',
  action: 'list',
  description:
    "List the organization's messaging campaigns (bulk SMS/email/WhatsApp " +
    'sends to an audience segment — NOT Meta Ads campaigns). Optional filter: ' +
    'status (draft, scheduled, sending, paused, sent, failed, cancelled). ' +
    'Returns the current page; `pageCount` is the size of THIS page.',
  inputSchema: listCampaignsInputSchema,
  destructive: false,
  preferredModel: 'sonnet',
  presentation: { statusLabel: 'Listing campaigns' },
  additionalAllowedPaths: [/^campaigns$/],
  execute: async (input, ctx) => {
    const params = new URLSearchParams();
    if (input.status) params.set('status', input.status);
    params.set('limit', String(input.limit));
    params.set('offset', String(input.offset));

    const data = await ctx.apiFetch(`campaigns?${params.toString()}`, {
      schema: messagingCampaignListResponseSchema,
    });

    return {
      data: {
        campaigns: data.items.map((c) => ({
          id: c.id,
          name: c.name,
          status: c.status,
          channels: c.channels,
          segmentId: c.segmentId,
          scheduledAt: c.scheduledAt,
        })),
        pageCount: data.items.length,
        limit: data.limit,
        offset: data.offset,
      },
    };
  },
});
