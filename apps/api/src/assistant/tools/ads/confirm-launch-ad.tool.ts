import { z } from 'zod';
import { defineTool } from '../../tool-factory/index.js';
import { confirmationCard } from '../_shared/confirmation-card.js';
import {
  META_AD_BY_ID_PATH,
  resolveAdBudgetDisplay,
} from './_shared/budget-display.js';

export const LAUNCH_AD_HARD_BLOCKS = [
  'noPomBrandNamesInAdCopy',
  'noFabricatedResultClaims',
  'noBeforeAfterImageryUkAds',
] as const;

interface ConfirmLaunchAdOutput {
  confirmationToken?: string;
  adId: string;
  expiresAt?: string;
  /** Echoed display fields so the AdConfirmation renderer (variant=launch)
   *  has everything it needs from the tool input/output pair. */
  adName?: string;
  headline?: string;
  primaryText?: string;
  campaignName?: string;
  videoTitle?: string;
  targeting?: string;
  callToAction?: string;
  destinationUrl?: string;
  budgetDisplay?: string;
  /** When a hard-block fires, the renderer surfaces this and the model
   *  is told to revise. No token is issued. */
  hardBlock?: { code: string; message: string };
  error?: string;
}

/**
 * `meta_ads_confirmLaunchAd` — propose an ad launch and ask the user to
 * approve. This is the *confirm* half of the two-tool destructive pattern;
 * the *execute* half is `meta_ads_executeLaunchAd`.
 *
 * Why two tools (W-C05 D-1): the frontend uses
 * `addToolOutput({ output: 'approved' | 'rejected' })` paired with auto-send
 * to translate operator clicks into the model's next-turn input. Collapsing
 * to a single `launchAd` tool with the factory's destructive=true flow
 * would require re-invocation, which the current frontend doesn't support.
 * See window-c05.md D-1 for the full reasoning.
 *
 * What this tool does:
 *   1. Run the launch-relevant hard-blocks manually (`noPomBrandNamesInAdCopy`,
 *      `noFabricatedResultClaims`, `noBeforeAfterImageryUkAds`). The factory
 *      only auto-runs hard-blocks for `destructive: true` tools' first call;
 *      we mirror the behaviour here so the operator never sees a "Launch?"
 *      card for copy that should never have been proposed.
 *   2. Issue a DB-backed confirmation token (`ctx.createConfirmation`). The
 *      token is bound to action=`launch_ad` + resourceId=`adId` + the full
 *      input as the payload, so the model can't quietly switch the launch
 *      target between confirmation and execute.
 *   3. Return the input fields the AdConfirmation renderer reads + the
 *      token + expiresAt. The renderer reads these directly from the tool's
 *      input — and the model echoes the token into `executeLaunchAd`.
 */
export const confirmLaunchAdTool = defineTool<
  {
    adId: string;
    adName: string;
    headline?: string;
    primaryText?: string;
    campaignName: string;
    videoTitle?: string;
    targeting?: string;
    callToAction?: string;
    destinationUrl?: string;
  },
  ConfirmLaunchAdOutput
>({
  feature: 'meta-ads',
  action: 'confirmLaunchAd',
  description:
    'Ask the user to confirm launching an ad. Present the ad summary ' +
    '(headline, primary text, campaign, targeting, budget, destination URL) ' +
    'and wait for approval before calling executeLaunchAd. ' +
    'Returns a confirmationToken that must be passed to executeLaunchAd.',
  inputSchema: z.object({
    adId: z.string().min(1).describe('The draft ad ID to launch'),
    adName: z.string().describe('Ad name to display'),
    headline: z.string().optional().describe('Ad headline preview'),
    primaryText: z.string().optional().describe('Ad primary text preview'),
    campaignName: z.string().describe('Campaign name the ad belongs to'),
    videoTitle: z.string().optional().describe('Video title for context'),
    targeting: z
      .string()
      .optional()
      .describe('Human-readable targeting summary'),
    callToAction: z.string().optional().describe('CTA button label'),
    destinationUrl: z
      .string()
      .optional()
      .describe('Landing page URL for the ad'),
  }),
  destructive: false,
  preferredModel: 'sonnet',
  presentation: {
    statusLabel: 'Preparing launch confirmation',
    confirmationRenderer: 'ad-confirmation:launch',
  },
  // Resolves the ad's parent campaign (for the server-derived budget display)
  // via GET /meta-ads/:id — not on the base whitelist.
  additionalAllowedPaths: [META_AD_BY_ID_PATH],
  execute: async (input, ctx) => {
    // Manual hard-block check (factory auto-runs only for destructive tools).
    const hbResult = await ctx.runHardBlocks(LAUNCH_AD_HARD_BLOCKS, input, ctx);
    if (!hbResult.pass) {
      return {
        data: {
          adId: input.adId,
          adName: input.adName,
          headline: input.headline,
          primaryText: input.primaryText,
          campaignName: input.campaignName,
          hardBlock: { code: hbResult.code, message: hbResult.message },
        },
        presentation: {
          type: 'hard_block_violation',
          code: hbResult.code,
          message: hbResult.message,
        },
      };
    }

    // Budget shown on the confirmation card is derived SERVER-SIDE from the
    // ad's parent campaign — the model no longer authors the money string
    // (register #82). Best-effort: null omits the money line on the card.
    const { budgetDisplay } = await resolveAdBudgetDisplay(ctx, {
      organizationId: ctx.organizationId,
      adId: input.adId,
    });

    try {
      const token = await ctx.createConfirmation({
        action: 'launch_ad',
        resourceId: input.adId,
        payload: input as unknown as Record<string, unknown>,
      });
      return {
        presentation: confirmationCard({
          action: 'launch_ad',
          resourceId: input.adId,
          token: token.id,
          expiresAt: token.expiresAt,
          title: `Launch "${input.adName}"?`,
          // Money and reach first — those are what make this irreversible.
          fields: [
            // The SERVER-derived budget, not a string the model authored
            // (register #82). `input` no longer carries one.
            ...(budgetDisplay
              ? [{ label: 'Budget', value: budgetDisplay }]
              : []),
            { label: 'Campaign', value: input.campaignName },
            ...(input.headline
              ? [{ label: 'Headline', value: input.headline }]
              : []),
            ...(input.targeting
              ? [{ label: 'Targeting', value: input.targeting }]
              : []),
            ...(input.destinationUrl
              ? [{ label: 'Sends people to', value: input.destinationUrl }]
              : []),
          ],
          executeToolName: 'meta_ads_executeLaunchAd',
          confirmLabel: 'Launch',
        }),
        data: {
          confirmationToken: token.id,
          adId: input.adId,
          expiresAt: token.expiresAt.toISOString(),
          adName: input.adName,
          headline: input.headline,
          primaryText: input.primaryText,
          campaignName: input.campaignName,
          videoTitle: input.videoTitle,
          targeting: input.targeting,
          callToAction: input.callToAction,
          destinationUrl: input.destinationUrl,
          budgetDisplay: budgetDisplay ?? undefined,
        },
      };
    } catch (error) {
      ctx.reportIssue('Failed to issue launch confirmation', { error });
      return {
        data: {
          adId: input.adId,
          error:
            error instanceof Error
              ? error.message
              : 'Failed to issue confirmation.',
        },
      };
    }
  },
});
