import { z } from 'zod';
import { defineTool } from '../../tool-factory/index.js';
import { confirmationCard } from '../_shared/confirmation-card.js';

const safeExternalId = z.string().regex(/^[\w-]+$/, 'Invalid ID format');

const PAUSE_AD_HARD_BLOCKS = [
  'noLiveCampaignChangeDuringLearningPhase',
] as const;

interface ConfirmPauseAdOutput {
  confirmationToken?: string;
  metaCampaignId: string;
  expiresAt?: string;
  campaignName?: string;
  adCount?: number;
  performanceSummary?: string;
  hardBlock?: { code: string; message: string };
  error?: string;
}

/**
 * `meta_ads_confirmPauseAd` — propose a campaign pause and ask for approval.
 *
 * Two-tool destructive pattern (see `confirm-launch-ad.tool.ts` for the
 * shared rationale). Hard-blocks fire here:
 *   - `noLiveCampaignChangeDuringLearningPhase` — checks
 *     `metaCampaigns.learningStatus`; refuses to pause inside the 7–10 day
 *     learning window because pausing resets the algorithm's progress.
 *
 * On pass: issues a DB-backed token bound to action=`pause_campaign` +
 * resourceId=`metaCampaignId`. Returns the display fields the
 * AdConfirmation renderer (variant=pause) needs.
 */
export const confirmPauseAdTool = defineTool<
  {
    metaCampaignId: string;
    campaignName: string;
    adCount?: number;
    performanceSummary?: string;
  },
  ConfirmPauseAdOutput
>({
  feature: 'meta-ads',
  action: 'confirmPauseAd',
  description:
    'Ask the user to confirm pausing a Meta campaign. Pausing a campaign ' +
    'stops delivery of ALL ads in that campaign. Present the campaign summary ' +
    'and wait for approval before calling executePauseAd. ' +
    'Returns a confirmationToken that must be passed to executePauseAd.',
  inputSchema: z.object({
    metaCampaignId: safeExternalId.describe('The campaign ID to pause'),
    campaignName: z.string().describe('Campaign name to display'),
    adCount: z.number().optional().describe('Number of ads in the campaign'),
    performanceSummary: z
      .string()
      .optional()
      .describe(
        'Brief performance summary (e.g., "€45 spent, 3 leads this week")'
      ),
  }),
  destructive: false,
  preferredModel: 'sonnet',
  presentation: {
    statusLabel: 'Preparing pause confirmation',
    confirmationRenderer: 'ad-confirmation:pause',
  },
  execute: async (input, ctx) => {
    const hbResult = await ctx.runHardBlocks(PAUSE_AD_HARD_BLOCKS, input, ctx);
    if (!hbResult.pass) {
      return {
        data: {
          metaCampaignId: input.metaCampaignId,
          campaignName: input.campaignName,
          adCount: input.adCount,
          performanceSummary: input.performanceSummary,
          hardBlock: { code: hbResult.code, message: hbResult.message },
        },
        presentation: {
          type: 'hard_block_violation',
          code: hbResult.code,
          message: hbResult.message,
        },
      };
    }

    try {
      const token = await ctx.createConfirmation({
        action: 'pause_campaign',
        resourceId: input.metaCampaignId,
        payload: input as unknown as Record<string, unknown>,
      });
      return {
        presentation: confirmationCard({
          action: 'pause_campaign',
          resourceId: input.metaCampaignId,
          token: token.id,
          expiresAt: token.expiresAt,
          title: `Pause "${input.campaignName}"?`,
          fields: [
            ...(input.adCount !== undefined
              ? [
                  {
                    label: 'Ads affected',
                    value: String(input.adCount),
                  },
                ]
              : []),
            ...(input.performanceSummary
              ? [{ label: 'Performance', value: input.performanceSummary }]
              : []),
            { label: 'Effect', value: 'Delivery stops. Nothing is deleted.' },
          ],
          executeToolName: 'meta_ads_executePauseAd',
          confirmLabel: 'Pause',
        }),
        data: {
          confirmationToken: token.id,
          metaCampaignId: input.metaCampaignId,
          expiresAt: token.expiresAt.toISOString(),
          campaignName: input.campaignName,
          adCount: input.adCount,
          performanceSummary: input.performanceSummary,
        },
      };
    } catch (error) {
      ctx.reportIssue('Failed to issue pause confirmation', { error });
      return {
        data: {
          metaCampaignId: input.metaCampaignId,
          error:
            error instanceof Error
              ? error.message
              : 'Failed to issue confirmation.',
        },
      };
    }
  },
});
