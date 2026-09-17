import { pauseCampaignResponseSchema } from '@borradh-workspace/contracts';
import { z } from 'zod';
import { ApiFetchError, defineTool } from '../../tool-factory/index.js';

const safeExternalId = z.string().regex(/^[\w-]+$/, 'Invalid ID format');

interface ExecutePauseAdOutput {
  metaCampaignId?: string;
  /**
   * The campaign `effective_status` READ BACK from Meta after the pause
   * (ADR-005), or `'UNVERIFIED'` when the read-back failed. Never a hardcoded
   * `'PAUSED'`: a pause request that Meta accepted but has not applied must
   * not be reported as a stopped campaign.
   */
  status?: string;
  message?: string;
  error?: string;
}

/**
 * `meta_ads_executePauseAd` — pause the campaign on Meta.
 *
 * Verifies the token issued by `confirmPauseAd` (action=`pause_campaign`,
 * resourceId=`metaCampaignId`) and consumes it on success. If the token
 * is invalid, expired, or refers to a different campaign, the model is
 * told to re-confirm — the actual API call never fires.
 */
export const executePauseAdTool = defineTool<
  { metaCampaignId: string; confirmationToken: string },
  ExecutePauseAdOutput
>({
  feature: 'meta-ads',
  action: 'executePauseAd',
  description:
    'Pause a Meta campaign after the user has approved via confirmPauseAd. ' +
    'Requires the confirmationToken returned by confirmPauseAd.',
  inputSchema: z.object({
    metaCampaignId: safeExternalId.describe('The campaign ID to pause'),
    confirmationToken: z
      .string()
      .describe('Token from confirmPauseAd (required)'),
  }),
  destructive: false,
  preferredModel: 'sonnet',
  presentation: { statusLabel: 'Pausing campaign' },
  execute: async ({ metaCampaignId, confirmationToken }, ctx) => {
    const verification = await ctx.verifyConfirmation({
      token: confirmationToken,
      action: 'pause_campaign',
      resourceId: metaCampaignId,
    });
    if (!verification.valid) {
      return {
        data: {
          error: `Confirmation is no longer valid (${verification.reason}). Please re-run confirmPauseAd.`,
        },
        presentation: {
          type: 'confirmation_expired',
          reason: verification.reason,
        },
      };
    }

    try {
      const ack = await ctx.apiFetch(`meta-campaigns/${metaCampaignId}/pause`, {
        method: 'POST',
        schema: pauseCampaignResponseSchema,
      });
      // Report the READ-BACK campaign state (ADR-005). Only claim delivery
      // has stopped when Meta confirmed a paused state; a failed read-back
      // is reported as submitted-but-unverified.
      const readBack = ack.campaignEffectiveStatus ?? null;
      // `IN_PROCESS` is a delivering state on Meta, not a stopped one — it
      // must not count as a confirmed pause any more than `ACTIVE` does.
      const stillDelivering =
        readBack === 'ACTIVE' || readBack === 'IN_PROCESS';
      const confirmedPaused = readBack !== null && !stillDelivering;
      return {
        data: {
          metaCampaignId,
          status: readBack ?? 'UNVERIFIED',
          message: confirmedPaused
            ? `Campaign paused — Meta confirms it is ${readBack}. All ads in this campaign have stopped delivering.`
            : stillDelivering
              ? `The pause request was accepted, but Meta still reports the campaign as ${readBack} — do not report it as paused. Re-check the campaign status.`
              : 'The pause request was submitted, but the campaign status could not be verified with Meta. Do not report it as paused until verified.',
        },
      };
    } catch (error) {
      const isExpectedClientError =
        error instanceof ApiFetchError &&
        error.status >= 400 &&
        error.status < 500;
      if (!isExpectedClientError) {
        ctx.reportIssue('Failed to pause campaign', { error });
      }
      return {
        data: {
          error:
            error instanceof Error
              ? error.message
              : 'Failed to pause campaign.',
        },
      };
    }
  },
});
