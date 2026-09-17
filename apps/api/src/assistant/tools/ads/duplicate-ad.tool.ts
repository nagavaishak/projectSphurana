import { z } from 'zod';
import { ApiFetchError, defineTool } from '../../tool-factory/index.js';

const safeExternalId = z.string().regex(/^[\w-]+$/, 'Invalid ID format');

// Not on the shared whitelist (path-whitelist.ts) — this tool calls
// `ctx.apiFetch` directly rather than through a port, so an `additionalAllowedPaths`
// extension is the dominant convention (see META_AD_BY_ID_PATH in
// `_shared/budget-display.ts`). Without this, every duplicate call failed the
// whitelist and surfaced as "This action is not available." (ENG-852).
const DUPLICATE_AD_PATH = /^meta-ads\/[a-zA-Z0-9_-]+\/duplicate$/;

interface DuplicateAdApiResponse {
  id: string;
  name: string;
  status: string;
}

interface DuplicateAdOutput {
  id?: string;
  name?: string;
  status?: string;
  message?: string;
  error?: string;
}

/**
 * `meta_ads_duplicateAd` — duplicate a single ad.
 *
 * Non-destructive. Borradh-made ads (with a local creative) are duplicated as
 * an editable DRAFT to review + launch; imported ads are copied PAUSED on Meta.
 * Either way nothing spends until it's launched.
 */
export const duplicateAdTool = defineTool<{ adId: string }, DuplicateAdOutput>({
  feature: 'meta-ads',
  action: 'duplicateAd',
  description:
    'Duplicate a single ad. Ads built in Borradh are duplicated as an ' +
    'editable draft to review and launch; ads imported from Meta are copied ' +
    'paused. Nothing spends until the duplicate is launched. Provide the adId ' +
    '(the local ad id, e.g. from listRecentAds).',
  inputSchema: z.object({
    adId: safeExternalId.describe('The ad ID (local id) to duplicate'),
  }),
  destructive: false,
  preferredModel: 'sonnet',
  presentation: { statusLabel: 'Duplicating ad' },
  additionalAllowedPaths: [DUPLICATE_AD_PATH],
  execute: async ({ adId }, ctx) => {
    try {
      const data = await ctx.apiFetch<DuplicateAdApiResponse>(
        `meta-ads/${adId}/duplicate`,
        { method: 'POST' }
      );
      const isDraft = data.status === 'draft';
      return {
        data: {
          id: data.id,
          name: data.name,
          status: data.status,
          message: isDraft
            ? `Duplicated as a draft ("${data.name}") — review and launch it when ready.`
            : `Duplicated ("${data.name}"), paused on Meta.`,
        },
      };
    } catch (error) {
      const isExpectedClientError =
        error instanceof ApiFetchError &&
        error.status >= 400 &&
        error.status < 500;
      if (!isExpectedClientError) {
        ctx.reportIssue('Failed to duplicate ad', { error });
      }
      return {
        data: {
          error:
            error instanceof Error ? error.message : 'Failed to duplicate ad.',
        },
      };
    }
  },
});
