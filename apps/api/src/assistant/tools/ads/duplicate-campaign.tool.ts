import { queueDuplicateCampaignResponseSchema } from '@borradh-workspace/contracts';
import { z } from 'zod';
import { ApiFetchError, defineTool } from '../../tool-factory/index.js';

const safeExternalId = z.string().regex(/^[\w-]+$/, 'Invalid ID format');

// Not on the shared whitelist (path-whitelist.ts) — this tool calls
// `ctx.apiFetch` directly rather than through a port, so an `additionalAllowedPaths`
// extension is the dominant convention (see META_AD_BY_ID_PATH in
// `_shared/budget-display.ts`). Without this, every duplicate call failed the
// whitelist and surfaced as "This action is not available." (ENG-852).
const DUPLICATE_CAMPAIGN_PATH = /^meta-campaigns\/[a-zA-Z0-9_-]+\/duplicate$/;

interface DuplicateCampaignOutput {
  queued?: boolean;
  message?: string;
  error?: string;
}

/**
 * `meta_ads_duplicateCampaign` — duplicate a Meta campaign and all of its ads.
 *
 * Non-destructive: the copy is created PAUSED (it never spends until an ad in
 * it is launched) and the work runs on a background worker — the endpoint just
 * enqueues and returns. The new "… (Copy)" campaign appears in the campaigns
 * list once the job finishes.
 */
export const duplicateCampaignTool = defineTool<
  { metaCampaignId: string },
  DuplicateCampaignOutput
>({
  feature: 'meta-ads',
  action: 'duplicateCampaign',
  description:
    'Duplicate a Meta campaign and all of its ads. The copy is created paused ' +
    '(nothing spends until an ad in it is launched) and is built in the ' +
    'background, appearing in the campaigns list shortly. Provide the ' +
    'metaCampaignId of the campaign to copy (from listCampaigns).',
  inputSchema: z.object({
    metaCampaignId: safeExternalId.describe('The campaign ID to duplicate'),
  }),
  destructive: false,
  preferredModel: 'sonnet',
  presentation: { statusLabel: 'Duplicating campaign' },
  additionalAllowedPaths: [DUPLICATE_CAMPAIGN_PATH],
  execute: async ({ metaCampaignId }, ctx) => {
    try {
      await ctx.apiFetch(`meta-campaigns/${metaCampaignId}/duplicate`, {
        method: 'POST',
        schema: queueDuplicateCampaignResponseSchema,
      });
      return {
        data: {
          queued: true,
          message:
            'Duplicating the campaign and its ads in the background — the ' +
            'paused copy will appear in the campaigns list shortly.',
        },
      };
    } catch (error) {
      const isExpectedClientError =
        error instanceof ApiFetchError &&
        error.status >= 400 &&
        error.status < 500;
      if (!isExpectedClientError) {
        ctx.reportIssue('Failed to duplicate campaign', { error });
      }
      return {
        data: {
          error:
            error instanceof Error
              ? error.message
              : 'Failed to duplicate campaign.',
        },
      };
    }
  },
});
