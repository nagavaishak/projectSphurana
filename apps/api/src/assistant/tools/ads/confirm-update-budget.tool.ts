import { z } from 'zod';
import { defineTool } from '../../tool-factory/index.js';
import { confirmationCard } from '../_shared/confirmation-card.js';

const safeExternalId = z.string().regex(/^[\w-]+$/, 'Invalid ID format');

const UPDATE_BUDGET_HARD_BLOCKS = [
  'noLiveCampaignChangeDuringLearningPhase',
  'noScalingBeforeLearningExits',
] as const;

interface ConfirmUpdateBudgetOutput {
  /**
   * Discriminant. `blocked` used to be expressed as a `hardBlock` field sitting
   * inside an otherwise-successful result — which shipped 6 times in
   * production, was never read, and left an owner believing a refused $20/day
   * change had been made while the campaign ran at $15.
   *
   * A refusal is now a different STATE, not a success with a field on it, so a
   * caller cannot reach `confirmationToken` without passing the branch.
   */
  status: 'awaiting_approval' | 'blocked' | 'failed';
  metaCampaignId: string;
  /** Present only when `status === 'awaiting_approval'`. */
  confirmationToken?: string;
  expiresAt?: string;
  campaignName?: string;
  currentBudgetCents?: number;
  newBudgetCents?: number;
  /** Present only when `status === 'blocked'`. */
  blockedReason?: { code: string; message: string };
  /** Present only when `status === 'failed'`. */
  error?: string;
}

/**
 * `meta_ads_confirmUpdateBudget` — propose a daily-budget change.
 *
 * Two-tool destructive pattern. Hard-blocks fire here:
 *   - `noLiveCampaignChangeDuringLearningPhase` — any change inside the
 *     learning window resets the algorithm.
 *   - `noScalingBeforeLearningExits` — even outside an absolute pause,
 *     scaling specifically is blocked when the campaign is still learning.
 *     The validator inspects `newBudgetCents > currentBudgetCents` so a
 *     *de-*scale during learning is left to the first validator.
 *
 * Issues a DB-backed token bound to action=`update_budget` +
 * resourceId=`metaCampaignId` + the full input as payload (so a model
 * that swaps the budget mid-stream gets caught by token verification).
 */
export const confirmUpdateBudgetTool = defineTool<
  {
    metaCampaignId: string;
    campaignName: string;
    currentBudgetCents?: number;
    newBudgetCents: number;
  },
  ConfirmUpdateBudgetOutput
>({
  feature: 'meta-ads',
  action: 'confirmUpdateBudget',
  description:
    'Ask the user to confirm changing a campaign daily budget. Show the ' +
    'current and new budget amounts and wait for approval before calling ' +
    'executeUpdateBudget. ' +
    'Returns a confirmationToken that must be passed to executeUpdateBudget.',
  inputSchema: z.object({
    metaCampaignId: safeExternalId.describe('The campaign ID to update'),
    campaignName: z.string().describe('Campaign name to display'),
    currentBudgetCents: z
      .number()
      .optional()
      .describe('Current daily budget in cents'),
    newBudgetCents: z
      .number()
      .describe('New daily budget in cents (min 100 = €1/day)'),
  }),
  destructive: false,
  // Mirrors @RequireRole('admin') on PUT /meta-campaigns/:metaCampaignId. The
  // gate is currently enforced ONLY by the authenticated loopback hop; nothing
  // reads this field yet. It is declared so Gate 3 can count it, and so the
  // extraction that removes the hop has something to move enforcement TO.
  policy: 'admin',
  preferredModel: 'sonnet',
  presentation: {
    statusLabel: 'Preparing budget confirmation',
    confirmationRenderer: 'ad-confirmation:budget',
  },
  execute: async (input, ctx) => {
    const hbResult = await ctx.runHardBlocks(
      UPDATE_BUDGET_HARD_BLOCKS,
      input,
      ctx
    );
    if (!hbResult.pass) {
      return {
        data: {
          status: 'blocked',
          metaCampaignId: input.metaCampaignId,
          campaignName: input.campaignName,
          currentBudgetCents: input.currentBudgetCents,
          newBudgetCents: input.newBudgetCents,
          blockedReason: { code: hbResult.code, message: hbResult.message },
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
        action: 'update_budget',
        resourceId: input.metaCampaignId,
        payload: input as unknown as Record<string, unknown>,
      });
      const money = (cents: number) => `€${(cents / 100).toFixed(2)}`;
      return {
        presentation: confirmationCard({
          action: 'update_budget',
          resourceId: input.metaCampaignId,
          token: token.id,
          expiresAt: token.expiresAt,
          title: `Change the budget on "${input.campaignName}"?`,
          // Both numbers, always. A budget change stated as one figure reads as
          // the new total to some owners and as the increase to others.
          fields: [
            ...(input.currentBudgetCents !== undefined
              ? [
                  {
                    label: 'Now',
                    value: `${money(input.currentBudgetCents)}/day`,
                  },
                ]
              : []),
            { label: 'After', value: `${money(input.newBudgetCents)}/day` },
          ],
          executeToolName: 'meta_ads_executeUpdateBudget',
          confirmLabel: 'Update budget',
        }),
        data: {
          status: 'awaiting_approval',
          confirmationToken: token.id,
          metaCampaignId: input.metaCampaignId,
          expiresAt: token.expiresAt.toISOString(),
          campaignName: input.campaignName,
          currentBudgetCents: input.currentBudgetCents,
          newBudgetCents: input.newBudgetCents,
        },
      };
    } catch (error) {
      ctx.reportIssue('Failed to issue budget confirmation', { error });
      return {
        data: {
          status: 'failed',
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
