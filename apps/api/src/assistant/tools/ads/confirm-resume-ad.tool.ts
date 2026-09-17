import { z } from 'zod';
import { defineTool } from '../../tool-factory/index.js';
import { confirmationCard } from '../_shared/confirmation-card.js';

const safeExternalId = z.string().regex(/^[\w-]+$/, 'Invalid ID format');

interface ConfirmResumeAdOutput {
  confirmationToken?: string;
  metaCampaignId: string;
  expiresAt?: string;
  campaignName?: string;
  dailyBudgetDisplay?: string;
  error?: string;
}

/**
 * `meta_ads_confirmResumeAd` — ask before restarting a campaign's spend.
 *
 * WHY THIS EXISTS. Gate 6 found the asymmetry: `pause` was exposed and
 * confirmed, and `resume` had no tool at all. Claire could stop an owner's ad
 * spend and then could not start it again — a half-capability, which is worse
 * than none, because the owner is left in a state only the dashboard can undo.
 *
 * WHY IT IS CONFIRMED. Pause is the SAFE direction: it stops money leaving.
 * Resume starts it again, at whatever daily budget the campaign still carries.
 * Confirming the reversible half and not the irreversible one would be exactly
 * backwards, so this mirrors the pause pair rather than shipping as a bare
 * write.
 *
 * The budget is surfaced in the confirmation on purpose — "resume Summer
 * Facials" and "resume Summer Facials at €40/day" are different decisions, and
 * the owner may have forgotten which it was when they paused.
 */
export const confirmResumeAdTool = defineTool<
  {
    metaCampaignId: string;
    campaignName: string;
    dailyBudgetDisplay?: string;
  },
  ConfirmResumeAdOutput
>({
  feature: 'meta-ads',
  action: 'confirmResumeAd',
  description:
    'Ask the user to confirm RESUMING a paused Meta campaign. Resuming ' +
    'restarts delivery and spend for every ad in the campaign. Present the ' +
    'campaign name and its daily budget, then wait for approval before ' +
    'calling executeResumeAd. Returns a confirmationToken that must be passed ' +
    'to executeResumeAd.',
  inputSchema: z.object({
    metaCampaignId: safeExternalId.describe('The campaign ID to resume'),
    campaignName: z.string().describe('Campaign name to display'),
    dailyBudgetDisplay: z
      .string()
      .optional()
      .describe(
        'The daily budget it will resume at, already formatted (e.g. "€40/day"). ' +
          'Read it from listCampaigns — do not guess.'
      ),
  }),
  destructive: false,
  // Matches `@RequireRole('admin')` on POST /meta-campaigns/:id/resume. A
  // policy looser than the route it calls would be a gate that only looks
  // like one.
  policy: 'admin',
  preferredModel: 'sonnet',
  presentation: { statusLabel: 'Preparing resume confirmation' },
  execute: async (input, ctx) => {
    try {
      const token = await ctx.createConfirmation({
        action: 'resume_campaign',
        resourceId: input.metaCampaignId,
        payload: input as unknown as Record<string, unknown>,
      });
      return {
        presentation: confirmationCard({
          action: 'resume_campaign',
          resourceId: input.metaCampaignId,
          token: token.id,
          expiresAt: token.expiresAt,
          title: `Resume "${input.campaignName}"?`,
          fields: [
            ...(input.dailyBudgetDisplay
              ? [{ label: 'Daily budget', value: input.dailyBudgetDisplay }]
              : []),
            {
              label: 'Effect',
              value: 'Delivery restarts and spending resumes.',
            },
          ],
          executeToolName: 'meta_ads_executeResumeAd',
          confirmLabel: 'Resume',
        }),
        data: {
          confirmationToken: token.id,
          metaCampaignId: input.metaCampaignId,
          expiresAt: token.expiresAt.toISOString(),
          campaignName: input.campaignName,
          dailyBudgetDisplay: input.dailyBudgetDisplay,
        },
      };
    } catch (error) {
      ctx.reportIssue('Failed to issue resume confirmation', { error });
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
