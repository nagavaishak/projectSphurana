import { metaAdAtomSchema } from '@borradh-workspace/contracts';
import { db } from '@borradh-workspace/database';
import { resolveBudgetFailureInterlock } from '@borradh-workspace/features/assistant';
import { z } from 'zod';
import {
  ApiFetchError,
  ApiResponseContractError,
  defineTool,
  sanitizeApiError,
} from '../../tool-factory/index.js';
import {
  META_AD_BY_ID_PATH,
  resolveAdCampaignId,
  resolveCampaignBudgetDisplay,
} from './_shared/budget-display.js';
import { LAUNCH_AD_HARD_BLOCKS } from './confirm-launch-ad.tool.js';

/**
 * `POST /meta-ads/:id/publish` returns `publishAd`'s result verbatim, and that
 * service ends in `ok({ ad: updatedAd })` — the ad is NESTED.
 *
 * This tool used to assert a FLAT `{ id, name, status }` on that body. Because
 * a caller-supplied generic on `apiFetch` asserts rather than parses, nothing
 * threw: `data.name` was
 * simply `undefined`, and the success card went out reading
 * "Ad launched: undefined" with `adId: undefined`, beside a hardcoded
 * "Submitted to Meta — going live shortly". On the one tool that spends money.
 * The sibling `execute-pause-ad.tool.ts` documents the identical defect as
 * already fixed for pause.
 *
 * Derived from the generated atom and PARSED, so the field names are checked by
 * `tsc` against the real column set rather than by this file's belief about it.
 * `.pick()`ed to exactly the three fields read below: picking keeps unrelated
 * column drift from throwing on a money path, which a whole-atom parse would.
 */
const publishAdResponseSchema = z.object({
  ad: metaAdAtomSchema.pick({ id: true, name: true, status: true }),
  // Read-back state from Meta (ADR-005). `publishAd` verifies the ad's
  // effective_status + parent campaign status after the launch; this is the
  // ONLY thing the tool is entitled to say about whether the ad is live.
  // Optional so a deploy-skew window (API without the field) degrades to the
  // conservative "unverified" copy below rather than a contract error.
  launch: z
    .object({
      state: z.enum([
        'live',
        'live_but_campaign_paused',
        'pending_review',
        'paused_at_meta',
        'rejected',
        'failed',
        'unverified',
      ]),
      adEffectiveStatus: z.string().nullable(),
      campaignEffectiveStatus: z.string().nullable(),
      detail: z.string(),
    })
    .optional(),
  // Idempotency no-op (Phase 4 #95): true when the ad was ALREADY launched, so
  // this call created nothing and spent nothing — `launch` is a fresh re-read
  // of the existing live ad. The tool reports `already_live` so Claire tells
  // the owner it's already running instead of implying a new launch.
  alreadyLive: z.boolean().optional(),
});

type LaunchReadBack = NonNullable<
  z.infer<typeof publishAdResponseSchema>['launch']
>;

/**
 * The tool's own launch-state vocabulary: the read-back union PLUS the
 * `already_live` no-op signal (Phase 4). `already_live` is not a Meta
 * effective-status — it's the idempotency outcome, so it lives here rather
 * than in the read-back contract.
 */
type ToolLaunchState = LaunchReadBack['state'] | 'already_live';

/**
 * One truthful status line per union member — shown on the card and echoed
 * in `message`. No member ever says "going live" unless the state is `live`.
 */
const statusLineFor = (launch: LaunchReadBack): string => {
  switch (launch.state) {
    case 'live':
      return 'Live — verified with Meta';
    case 'live_but_campaign_paused':
      return 'Approved, but the campaign is PAUSED — not delivering';
    case 'pending_review':
      return 'In Meta review — not live yet';
    case 'paused_at_meta':
      return `Not delivering — Meta reports ${launch.adEffectiveStatus ?? 'PAUSED'}`;
    case 'rejected':
      return 'Rejected by Meta review — not running';
    case 'failed':
      return `Not running — Meta reports ${launch.adEffectiveStatus ?? 'an issue'}`;
    case 'unverified':
      return 'Submitted — status could not be verified with Meta';
  }
};

const UNVERIFIED_LAUNCH: LaunchReadBack = {
  state: 'unverified',
  adEffectiveStatus: null,
  campaignEffectiveStatus: null,
  detail:
    'The launch request was submitted, but the state could not be read back from Meta — the ad must not be reported as live until verified.',
};

interface CreatedField {
  label: string;
  value: string;
}

interface ExecuteLaunchAdOutput {
  uiState?: 'created';
  title?: string;
  fields?: CreatedField[];
  adId?: string;
  name?: string;
  status?: string;
  /**
   * Honest-state union read back from Meta AFTER the launch (ADR-005), plus the
   * `already_live` no-op signal. The model must quote this — never narrate
   * "live"/"going live" beyond it, and on `already_live` say the ad was already
   * running (no new ad was created).
   */
  launchState?: ToolLaunchState;
  /** Truthful sentence describing the verified state. */
  launchStateDetail?: string;
  /** True when nothing new was launched — the ad was already live (#95). */
  alreadyLive?: boolean;
  message?: string;
  preview?: {
    variant: 'launched';
    /** Same read-back union, for the card's status pill. */
    launchState?: ToolLaunchState;
    adName: string;
    headline?: string;
    primaryText?: string;
    callToAction?: string;
    campaignName?: string;
    videoTitle?: string;
    videoId?: string;
    budgetDisplay?: string;
    targetingDisplay?: string;
    destinationUrl?: string;
  };
  /**
   * Set when the launch was REFUSED because a budget change for this ad's
   * campaign failed earlier in the conversation and the owner hasn't yet said
   * to launch anyway (register #137). The model must relay this and ask before
   * retrying with `acknowledgeBudgetFailure: true` — it must NOT report the ad
   * as live.
   */
  blocked?: 'unacknowledged_budget_failure';
  error?: string;
}

/**
 * `meta_ads_executeLaunchAd` — publish the ad after the user approves.
 *
 * The execute half of the two-tool destructive flow, but now a `destructive:
 * true` factory tool (Phase 6, finding #131). Verification, the turn-boundary
 * rule, and payload binding all run in the factory BEFORE this tool's own
 * `execute` — this tool never re-verifies by hand.
 *
 * Two entry points, both governed by the factory:
 *   1. **Token from `confirmLaunchAd`** (the normal flow). The model echoes
 *      the `confirmationToken` from the confirmation card. The factory verifies
 *      token + action (`launch_ad`) + resourceId (`adId`), enforces the
 *      turn-boundary rule (the launch can only run in a LATER turn, after the
 *      operator replied to the card — a same-turn self-launch is refused), and
 *      binds the executed input to the confirmed payload (drift → reject).
 *   2. **No token** → the factory's own first-call path runs the launch
 *      hard-blocks and issues a confirmation card + token via
 *      `summarizeForConfirmation`. It does NOT launch. There is no
 *      "model-judged verbal approval" shortcut any more: chat approval after
 *      the card is the approval, verified by the turn-boundary rule.
 *
 * Hard-blocks run in the factory (on the first call / card issue), so this
 * tool's `execute` — reached only after a valid, turn-separated token — does
 * not re-run them: the verified token is the proof.
 *
 * On success the tool returns a `uiState: 'created'` payload so the chat
 * renders a launched-ad preview card with the caption / headline / CTA /
 * video / budget — the operator's confirmation that everything went live
 * with the copy they approved.
 */
export const executeLaunchAdTool = defineTool<
  {
    adId: string;
    confirmationToken?: string;
    /** Display-only fields for the launched-ad preview card. The model
     *  passes the same values it used for confirmLaunchAd so the launched
     *  card mirrors what the user approved. */
    adName?: string;
    headline?: string;
    primaryText?: string;
    callToAction?: string;
    campaignName?: string;
    videoTitle?: string;
    videoId?: string;
    targetingDisplay?: string;
    destinationUrl?: string;
    /** Set true ONLY after the owner explicitly approves launching despite a
     *  failed budget change for this campaign (register #137 interlock). */
    acknowledgeBudgetFailure?: boolean;
  },
  ExecuteLaunchAdOutput
>({
  feature: 'meta-ads',
  action: 'executeLaunchAd',
  description:
    // Turn-boundary gate (Phase 6, #131) is authoritative: no same-turn
    // self-launch, token required. Phase 1 adds the verified-state reporting
    // contract on top, and Phase 5 takes the money string off the model — the
    // three combine, they do not compete.
    'Publish an ad to Meta. This is money-moving and gated by the ' +
    'confirmation flow: call confirmLaunchAd first to show the operator the ' +
    'launch card, then — ONLY after the operator replies approving it in a ' +
    'later message — call executeLaunchAd with the confirmationToken from ' +
    'that card. You cannot confirm and launch in the same turn; the launch ' +
    'runs only once the operator has responded to the card. If you call this ' +
    'without a confirmationToken, it does NOT launch — it shows the ' +
    'confirmation card and waits for the operator. Always pass the display ' +
    'fields (adName, headline, primaryText, callToAction, campaignName, ' +
    'videoTitle, videoId, targetingDisplay, destinationUrl) so the ' +
    'launched-ad card mirrors what was approved AND the compliance checks ' +
    'can read the copy. The daily budget shown on the card is derived ' +
    'server-side from the campaign — do not pass it. ' +
    'The result carries `launchState` — the state READ BACK from Meta after ' +
    'the launch. Report exactly that state: never say the ad is live or ' +
    '"going live" unless launchState is "live". `live_but_campaign_paused` ' +
    'means the campaign is paused and nothing delivers until it is resumed ' +
    '(a separate confirmed action via confirmResumeAd). `already_live` means ' +
    'this ad was ALREADY launched — nothing new was created and no extra ' +
    'money was spent; tell the owner it is already running (do NOT launch again).',
  inputSchema: z.object({
    adId: z.string().min(1).describe('The ad ID to publish'),
    confirmationToken: z
      .string()
      .optional()
      .describe(
        'Token from confirmLaunchAd. Pass it to execute the launch the ' +
          'operator approved. Omit it only to (re-)show the confirmation ' +
          'card; without it the ad is NOT launched.'
      ),
    adName: z.string().optional().describe('Ad name for the preview card'),
    headline: z.string().optional().describe('Ad headline for the preview'),
    primaryText: z
      .string()
      .optional()
      .describe('Ad primary text for the preview'),
    callToAction: z
      .string()
      .optional()
      .describe('CTA label for the preview (e.g., BOOK_NOW)'),
    campaignName: z
      .string()
      .optional()
      .describe('Human-readable campaign name for the preview'),
    videoTitle: z.string().optional().describe('Video title for the preview'),
    videoId: z
      .string()
      .optional()
      .describe(
        'Video ID so the preview card can render a thumbnail / open the video preview dialog'
      ),
    targetingDisplay: z
      .string()
      .optional()
      .describe('One-line targeting summary for the preview'),
    destinationUrl: z
      .string()
      .optional()
      .describe('Destination URL for the preview'),
    acknowledgeBudgetFailure: z
      .boolean()
      .optional()
      .describe(
        'Set true ONLY when a prior launch returned blocked: ' +
          'unacknowledged_budget_failure AND the owner has now explicitly ' +
          'said to launch anyway despite the failed budget change. Never set ' +
          'it pre-emptively.'
      ),
  }),
  // Money-moving: the factory enforces the two-call confirmation flow, the
  // turn-boundary rule, and payload binding. `confirmLaunchAd` issues the
  // card + token; this tool consumes it. When called WITHOUT a token, the
  // factory's first-call path runs the hard-blocks and issues the card via
  // `summarizeForConfirmation` instead of launching.
  destructive: true,
  destructiveAction: 'launch_ad',
  hardBlocks: [...LAUNCH_AD_HARD_BLOCKS],
  preferredModel: 'sonnet',
  presentation: {
    statusLabel: 'Launching ad',
    confirmationRenderer: 'ad-confirmation:launch',
  },
  // Resolves the ad's parent campaign (for the server-derived budget display)
  // via GET /meta-ads/:id — not on the base whitelist.
  additionalAllowedPaths: [META_AD_BY_ID_PATH],
  // Reached only on a tokenless call (defence in depth — the normal flow gets
  // its card + token from `confirmLaunchAd`). Builds the launch confirmation
  // card and binds the operator's approval to the display copy so a second
  // call with drifted fields is rejected by the factory's payload check.
  summarizeForConfirmation: async (input) => ({
    resourceId: input.adId,
    title: input.adName ? `Launch "${input.adName}"` : 'Launch ad',
    fields: [
      ...(input.adName ? [{ label: 'Ad name', value: input.adName }] : []),
      ...(input.headline ? [{ label: 'Headline', value: input.headline }] : []),
      ...(input.campaignName
        ? [{ label: 'Campaign', value: input.campaignName }]
        : []),
      // No budget line here: the model no longer authors the money string
      // (register #82), and this tokenless path has not resolved the campaign
      // yet. The normal flow's card gets the server-derived figure from
      // `confirmLaunchAd`.
      ...(input.targetingDisplay
        ? [{ label: 'Targeting', value: input.targetingDisplay }]
        : []),
    ],
    payload: input as unknown as Record<string, unknown>,
  }),
  execute: async (input, ctx) => {
    // Verification, the turn-boundary rule, hard-blocks, and payload binding
    // all ran in the factory before we got here — a valid, turn-separated,
    // operator-approved token is the proof. Just publish.
    const { adId } = input;

    // Resolve the ad's parent campaign once — used by BOTH the budget-failure
    // interlock (below) and the server-derived budget display (after publish).
    const metaCampaignId = await resolveAdCampaignId(ctx, adId);

    // Money-truth interlock (register #137): if a budget change for this ad's
    // campaign FAILED earlier in this conversation, do NOT launch at the old
    // budget until the owner explicitly says to go ahead anyway.
    if (metaCampaignId) {
      const interlock = await resolveBudgetFailureInterlock(db, {
        organizationId: ctx.organizationId,
        conversationId: ctx.conversationId,
        metaCampaignId,
        acknowledged: input.acknowledgeBudgetFailure ?? false,
      });
      if (interlock.success && interlock.data.blocked) {
        return {
          data: {
            blocked: 'unacknowledged_budget_failure',
            error:
              "I'm holding this launch: the budget change for this campaign " +
              "didn't go through, so launching now would run the ad at the old " +
              'budget. Want me to launch it anyway at the current budget, or ' +
              'fix the budget first?',
          },
        };
      }
    }

    try {
      const {
        ad,
        launch: launchRaw,
        alreadyLive,
      } = await ctx.apiFetch(`meta-ads/${adId}/publish`, {
        method: 'POST',
        schema: publishAdResponseSchema,
      });
      // No read-back on the response ⇒ the state is unknown, not "live".
      const launch = launchRaw ?? UNVERIFIED_LAUNCH;
      // Idempotency no-op (#95): the ad was already launched. Report the
      // re-read state under the `already_live` label so Claire says it is
      // already running rather than implying a fresh launch.
      const toolLaunchState: ToolLaunchState = alreadyLive
        ? 'already_live'
        : launch.state;

      const adName = input.adName ?? ad.name;

      // Budget display is derived SERVER-SIDE from the campaign that actually
      // spends — never a model-authored string (register #82). Reuse the
      // campaign resolved above; best-effort, null omits the money line.
      const budgetDisplay = metaCampaignId
        ? (
            await resolveCampaignBudgetDisplay(ctx, {
              organizationId: ctx.organizationId,
              metaCampaignId,
            })
          ).budgetDisplay
        : null;

      const ctaLabel = input.callToAction
        ? input.callToAction.replace(/_/g, ' ').toLowerCase()
        : undefined;
      const primaryTextSnippet =
        input.primaryText && input.primaryText.length > 220
          ? `${input.primaryText.slice(0, 220)}…`
          : input.primaryText;

      const fields: CreatedField[] = [
        { label: 'Ad name', value: adName },
        ...(input.headline
          ? [{ label: 'Headline', value: input.headline }]
          : []),
        ...(primaryTextSnippet
          ? [{ label: 'Caption', value: primaryTextSnippet }]
          : []),
        ...(ctaLabel ? [{ label: 'Call to action', value: ctaLabel }] : []),
        ...(input.campaignName
          ? [{ label: 'Campaign', value: input.campaignName }]
          : []),
        ...(budgetDisplay
          ? [{ label: 'Daily budget', value: budgetDisplay }]
          : []),
        ...(input.targetingDisplay
          ? [{ label: 'Targeting', value: input.targetingDisplay }]
          : []),
        // The Status field quotes ONLY the read-back state (ADR-005). This
        // used to be hardcoded to "Submitted to Meta — going live shortly"
        // regardless of what came back — the false-success class (#105 #138
        // #201). No optimistic copy: `live` is said only when Meta said it.
        {
          label: 'Status',
          value: alreadyLive
            ? 'Already live — no new ad created; verified with Meta'
            : statusLineFor(launch),
        },
      ];

      const alreadyLiveDetail = `This ad was already launched — no new ad was created and no extra budget was spent. ${launch.detail}`;

      return {
        presentation: { type: 'ad_preview' as const },
        data: {
          uiState: 'created',
          title: alreadyLive
            ? `Ad already live: ${adName}`
            : launch.state === 'live'
              ? `Ad launched: ${adName}`
              : `Ad submitted: ${adName}`,
          fields,
          adId: ad.id,
          name: ad.name,
          status: ad.status,
          launchState: toolLaunchState,
          launchStateDetail: alreadyLive ? alreadyLiveDetail : launch.detail,
          ...(alreadyLive ? { alreadyLive: true } : {}),
          message: alreadyLive
            ? alreadyLiveDetail
            : launch.state === 'live_but_campaign_paused'
              ? `${launch.detail} Resuming the campaign is a separate confirmed action — offer confirmResumeAd if the user wants delivery to start.`
              : launch.detail,
          preview: {
            variant: 'launched',
            launchState: toolLaunchState,
            adName,
            headline: input.headline,
            primaryText: input.primaryText,
            callToAction: input.callToAction,
            campaignName: input.campaignName,
            videoTitle: input.videoTitle,
            videoId: input.videoId,
            budgetDisplay: budgetDisplay ?? undefined,
            targetingDisplay: input.targetingDisplay,
            destinationUrl: input.destinationUrl,
          },
        },
      };
    } catch (error) {
      // A CONTRACT error is not a launch failure. `apiFetch` parses AFTER the
      // request returns 2xx, and by then `publishAd` has created the ad on
      // Meta and submitted the activation. The money may already be moving.
      //
      // Reporting that as a failure is the worst available outcome: the owner
      // is told nothing happened, and Claire's natural next move is to launch
      // again — a second live ad on the same budget. But we could not read the
      // response, so we ALSO cannot claim it is live: report the submission as
      // real and the state as unverified (ADR-005), never "going live".
      if (error instanceof ApiResponseContractError) {
        ctx.reportIssue('Ad launched but the publish response did not parse', {
          error,
        });
        return {
          data: {
            uiState: 'created',
            title: `Ad submitted: ${input.adName ?? 'your ad'}`,
            launchState: UNVERIFIED_LAUNCH.state,
            launchStateDetail: UNVERIFIED_LAUNCH.detail,
            message: UNVERIFIED_LAUNCH.detail,
          },
        };
      }

      const isExpectedClientError =
        error instanceof ApiFetchError &&
        error.status >= 400 &&
        error.status < 500;
      if (!isExpectedClientError) {
        ctx.reportIssue('Failed to launch ad', { error });
      }
      const sanitizedMessage = sanitizeApiError(
        error instanceof Error ? error.message : 'Failed to launch ad.',
        error instanceof ApiFetchError ? error.status : 500
      );
      // The launch never happened here — `publishAd` either reverted the ad
      // to draft or left it retryable (ENG-852) — so it's factual to tell the
      // model the ad is still there and launchable again once the stated
      // problem is fixed, instead of leaving Claire to imply the ad is gone.
      const retryHint =
        'The ad is still saved and was not launched — it can be launched again once this is fixed.';
      return {
        data: {
          // Sanitized: this tool catches before `defineTool`'s own handler,
          // so it must not leak a raw schema/SQL/stack message to the owner.
          error: `${sanitizedMessage.replace(/\.?$/, '.')} ${retryHint}`,
        },
      };
    }
  },
});
