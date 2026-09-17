import { resumeCampaignResponseSchema } from '@borradh-workspace/contracts';
import { z } from 'zod';
import { ApiFetchError, defineTool } from '../../tool-factory/index.js';

const safeExternalId = z.string().regex(/^[\w-]+$/, 'Invalid ID format');

interface ExecuteResumeAdOutput {
  metaCampaignId?: string;
  /**
   * `'ACTIVE'` on success, and READ BACK rather than assumed.
   *
   * Unlike the pause acknowledgement — which is a bare `{ paused: true }`, so
   * `executePauseAd` has to infer `'PAUSED'` — `POST /meta-campaigns/:id/resume`
   * returns `{ metaCampaignId, status: 'ACTIVE' }`. The schema pins that, so
   * this reports what the server said instead of what the tool hoped.
   */
  status?: string;
  message?: string;
  error?: string;
}

/**
 * `meta_ads_executeResumeAd` — restart a paused campaign's delivery.
 *
 * Closes the asymmetry Gate 6 found: pause was exposed and confirmed, resume
 * had no tool. Claire could stop an owner's spend and not start it again.
 *
 * Verifies the token issued by `confirmResumeAd` (action=`resume_campaign`,
 * resourceId=`metaCampaignId`) and consumes it on success. An invalid, expired
 * or mismatched token means the API call never fires.
 */
export const executeResumeAdTool = defineTool<
  { metaCampaignId: string; confirmationToken: string },
  ExecuteResumeAdOutput
>({
  feature: 'meta-ads',
  action: 'executeResumeAd',
  description:
    'Resume a paused Meta campaign after the user has approved via ' +
    'confirmResumeAd. Restarts delivery and spend for every ad in the ' +
    'campaign. Requires the confirmationToken returned by confirmResumeAd.',
  inputSchema: z.object({
    metaCampaignId: safeExternalId.describe('The campaign ID to resume'),
    confirmationToken: z
      .string()
      .describe('Token from confirmResumeAd (required)'),
  }),
  destructive: false,
  // Matches `@RequireRole('admin')` on the route. Restarting spend is an
  // admin act on the HTTP path and must not be looser here.
  policy: 'admin',
  preferredModel: 'sonnet',
  presentation: { statusLabel: 'Resuming campaign' },
  execute: async ({ metaCampaignId, confirmationToken }, ctx) => {
    const verification = await ctx.verifyConfirmation({
      token: confirmationToken,
      action: 'resume_campaign',
      resourceId: metaCampaignId,
    });
    if (!verification.valid) {
      return {
        data: {
          error: `Confirmation is no longer valid (${verification.reason}). Please re-run confirmResumeAd.`,
        },
        presentation: {
          type: 'confirmation_expired',
          reason: verification.reason,
        },
      };
    }

    try {
      const ack = await ctx.apiFetch(
        `meta-campaigns/${metaCampaignId}/resume`,
        { method: 'POST', schema: resumeCampaignResponseSchema }
      );
      // The message carries ONLY the read-back state (ADR-005). 'ACTIVE'
      // means Meta confirmed delivery; anything else is reported as-is, and
      // an unverified read-back is reported as unverified — never as resumed.
      const message =
        ack.status === 'ACTIVE'
          ? 'Campaign resumed — Meta confirms it is ACTIVE. Ads in this ' +
            'campaign are delivering again and spending against their daily ' +
            'budget.'
          : ack.status === 'UNVERIFIED'
            ? 'The resume request was submitted, but the campaign status ' +
              'could not be verified with Meta. Do not assume it is ' +
              'delivering — check the campaign status before reporting it ' +
              'as resumed.'
            : `The resume request was submitted, but Meta reports the campaign as ${ack.status} — it is not confirmed delivering.`;
      return {
        data: {
          metaCampaignId: ack.metaCampaignId,
          status: ack.status,
          message,
        },
      };
    } catch (error) {
      const isExpectedClientError =
        error instanceof ApiFetchError &&
        error.status >= 400 &&
        error.status < 500;
      if (!isExpectedClientError) {
        ctx.reportIssue('Failed to resume campaign', { error });
      }
      return {
        data: {
          error:
            error instanceof Error
              ? error.message
              : 'Failed to resume campaign.',
        },
      };
    }
  },
});
