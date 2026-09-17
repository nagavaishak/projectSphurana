import { z } from 'zod';
import { defineTool } from '../../tool-factory/index.js';

const deleteDraftAdInputSchema = z.object({
  adId: z
    .string()
    .min(1)
    .regex(/^[\w-]+$/, 'Invalid ID format')
    .describe('UUID of the draft ad to delete. Must be in "draft" status.'),
  confirmationToken: z
    .string()
    .optional()
    .describe('Confirmation token from the first call. Pass back unchanged.'),
});

interface AdLookup {
  id: string;
  name: string;
  status: string;
}

interface DeleteDraftAdOutput {
  adId: string;
  deleted: boolean;
}

/**
 * `meta_ads_deleteDraftAd` — soft-delete a Meta ad draft that has not been launched.
 *
 * Only ads in "draft" status may be deleted. Launched, active, paused, or
 * otherwise live ads must be managed from the Meta Ads dashboard. The
 * factory two-call confirmation flow ensures the operator always reviews
 * which draft will be removed before the delete is committed.
 */
export const deleteDraftAdTool = defineTool<
  z.infer<typeof deleteDraftAdInputSchema>,
  DeleteDraftAdOutput
>({
  feature: 'meta-ads',
  action: 'deleteDraftAd',
  description:
    'Delete a Meta ad DRAFT that has not yet been launched. ' +
    'Only ads in "draft" status can be deleted via this tool. ' +
    'Launched or live ads must be managed from the Meta Ads dashboard. ' +
    'Requires operator confirmation. ' +
    'Use `listRecentAds` to find the ad ID first.',
  inputSchema: deleteDraftAdInputSchema,
  destructive: true,
  destructiveAction: 'delete_draft_ad',
  preferredModel: 'sonnet',
  presentation: { statusLabel: 'Deleting draft ad' },
  additionalAllowedPaths: [/^meta-ads\/[a-zA-Z0-9_-]+$/],
  summarizeForConfirmation: async (input, ctx) => {
    const ad = await ctx.apiFetch<AdLookup>(`meta-ads/${input.adId}`);

    if (ad.status !== 'draft') {
      throw new Error(
        `Cannot delete ad "${ad.name}" — it is in "${ad.status}" status. Only drafts can be deleted here. Use the Meta Ads dashboard to manage live ads.`
      );
    }

    return {
      title: `Delete draft ad "${ad.name}"`,
      fields: [
        { label: 'Ad name', value: ad.name },
        { label: 'Status', value: ad.status },
      ],
      resourceId: input.adId,
      payload: { adId: input.adId },
    };
  },
  execute: async (input, ctx) => {
    await ctx.apiFetch(`meta-ads/${input.adId}`, { method: 'DELETE' });

    return {
      data: {
        adId: input.adId,
        deleted: true,
      },
    };
  },
});
