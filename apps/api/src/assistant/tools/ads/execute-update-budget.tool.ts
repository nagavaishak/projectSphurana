import { db } from '@borradh-workspace/database';
import {
  clearBudgetFailure,
  flagBudgetFailure,
} from '@borradh-workspace/features/assistant';
import { z } from 'zod';
import { describeBudgetBlocked } from '../../ports/reason-messages.js';
import { defineTool } from '../../tool-factory/index.js';

const safeExternalId = z.string().regex(/^[\w-]+$/, 'Invalid ID format');

const UPDATE_BUDGET_HARD_BLOCKS = [
  'noLiveCampaignChangeDuringLearningPhase',
  'noScalingBeforeLearningExits',
] as const;

interface ExecuteUpdateBudgetOutput {
  metaCampaignId?: string;
  campaignName?: string;
  /**
   * The daily budget the SERVER confirmed, in cents. Present only when the
   * response actually carried one — never echoed back from the request. An
   * owner asked for $20/day, the change was refused, and every ad card showed
   * $20/day while the campaign ran at $15; quoting the request as fact is how
   * that happened.
   */
  dailyBudget?: number;
  message?: string;
  error?: string;
}

/**
 * `meta_ads_executeUpdateBudget` — apply the daily-budget change.
 *
 * Verifies the token issued by `confirmUpdateBudget`. The `executeUpdateBudget`
 * input doesn't carry `currentBudgetCents` (the model's input is just
 * `metaCampaignId + dailyBudget + token`), so we re-run the learning-phase
 * hard-blocks here as a defense-in-depth backstop. They're cheap (one API
 * call) and they catch the case where the campaign entered learning between
 * the confirmation and the execute call.
 */
export const executeUpdateBudgetTool = defineTool<
  {
    metaCampaignId: string;
    dailyBudget: number;
    confirmationToken: string;
  },
  ExecuteUpdateBudgetOutput
>({
  feature: 'meta-ads',
  action: 'executeUpdateBudget',
  description:
    'Update a campaign daily budget after the user has approved via confirmUpdateBudget. ' +
    'Requires the confirmationToken returned by confirmUpdateBudget.',
  inputSchema: z.object({
    metaCampaignId: safeExternalId.describe('The campaign ID to update'),
    dailyBudget: z
      .number()
      .int()
      .min(100)
      .describe('New daily budget in cents (min 100)'),
    confirmationToken: z
      .string()
      .describe('Token from confirmUpdateBudget (required)'),
  }),
  destructive: false,
  // Mirrors @RequireRole('admin') on PUT /meta-campaigns/:metaCampaignId. The
  // gate is currently enforced ONLY by the authenticated loopback hop; nothing
  // reads this field yet. It is declared so Gate 3 can count it, and so the
  // extraction that removes the hop has something to move enforcement TO.
  policy: 'admin',
  preferredModel: 'sonnet',
  presentation: { statusLabel: 'Updating budget' },
  execute: async ({ metaCampaignId, dailyBudget, confirmationToken }, ctx) => {
    const verification = await ctx.verifyConfirmation({
      token: confirmationToken,
      action: 'update_budget',
      resourceId: metaCampaignId,
    });
    if (!verification.valid) {
      return {
        data: {
          error: `Confirmation is no longer valid (${verification.reason}). Please re-run confirmUpdateBudget.`,
        },
        presentation: {
          type: 'confirmation_expired',
          reason: verification.reason,
        },
      };
    }

    // Defense-in-depth: re-run learning-phase hard-blocks. The campaign
    // could have entered learning between confirm and execute (rare but
    // possible if confirm was issued just before a fresh launch finalised).
    const hbResult = await ctx.runHardBlocks(
      UPDATE_BUDGET_HARD_BLOCKS,
      { metaCampaignId, dailyBudget },
      ctx
    );
    if (!hbResult.pass) {
      return {
        data: { error: hbResult.message },
        presentation: {
          type: 'hard_block_violation',
          code: hbResult.code,
          message: hbResult.message,
        },
      };
    }

    const result = await ctx.ports.metaAds.updateBudget({
      metaCampaignId,
      dailyBudgetCents: dailyBudget,
    });

    if (result.status === 'blocked') {
      if (result.reason.kind === 'server_error') {
        ctx.reportIssue('Failed to update budget', {
          extra: { metaCampaignId, reason: result.reason },
        });
      }
      // Money-truth interlock (register #137): the budget change did NOT apply.
      // Flag the campaign so a subsequent launch in this conversation is held
      // until the owner explicitly says to launch anyway at the old budget.
      await flagBudgetFailure(db, {
        organizationId: ctx.organizationId,
        conversationId: ctx.conversationId,
        metaCampaignId,
      });
      return {
        data: { metaCampaignId, error: describeBudgetBlocked(result.reason) },
      };
    }

    // From here the budget change was ACCEPTED by Meta — clear any prior
    // failure flag so a launch is no longer held on this campaign (#137).
    await clearBudgetFailure(db, {
      organizationId: ctx.organizationId,
      conversationId: ctx.conversationId,
      metaCampaignId,
    });

    if (result.status === 'accepted_unconfirmed') {
      // The write was accepted but the API returned no budget to read back, so
      // there is no figure this tool is entitled to state. Say exactly that.
      return {
        data: {
          metaCampaignId: result.metaCampaignId,
          message:
            'The budget change was accepted, but Meta has not confirmed the new amount yet. ' +
            'Check the campaign in a minute to see the value that took effect.',
        },
      };
    }

    return {
      data: {
        metaCampaignId: result.metaCampaignId,
        campaignName: result.campaignName ?? undefined,
        dailyBudget: result.dailyBudgetCents,
        // Built from the CONFIRMED value, not the requested one.
        message: `Budget updated to €${(result.dailyBudgetCents / 100).toFixed(2)}/day.`,
      },
    };
  },
});
