import type { AdCopyBlockedReason } from '@borradh-workspace/contracts/ports';
import { z } from 'zod';
import { defineTool } from '../../tool-factory/index.js';

/**
 * Human sentence for each `AdCopyBlockedReason`.
 *
 * Exhaustive over `kind` with no `default`, so adding a member to the union is
 * a compile error here rather than a vague "something went wrong" in chat.
 * (Destined for `../../ports/reason-messages.ts` alongside the others.)
 */
function describeAdCopyBlocked(reason: AdCopyBlockedReason): string {
  switch (reason.kind) {
    case 'empty_copy':
      return `The copy generator came back empty (no ${reason.missing.join(' or ')}), so there's nothing to show you. Try again in a moment, or write the copy yourself and I'll put it on the ad.`;
    case 'media_not_found':
      return `I couldn't find that video (${reason.mediaId}) to write copy about. List the videos and pick one that still exists.`;
    case 'rate_limited':
      return 'The copywriting service is busy right now. Give it a minute and ask me again.';
    case 'other':
      return reason.message;
    case 'server_error':
      return 'Something went wrong on our side while writing the ad copy. No copy was generated — try again in a moment.';
  }
}

interface GenerateAdCopyOutput {
  /**
   * Present ONLY on a successful generation, and never null. The tool used to
   * return `{ headline: null, primaryText: null, description: null }` with an
   * OK status — Claire then presented the nothing as generated copy. The port's
   * `AdCopy` has no nullable fields, so that result is now unrepresentable.
   */
  headline?: string;
  primaryText?: string;
  description?: string;
  callToAction?: string;
  error?: string;
}

/**
 * `meta_ads_generateAdCopy` — AI-generated ad copy for a video.
 *
 * Read-only: it returns a *proposal*, nothing is launched. The generation +
 * D2b hard-block retry loop lives in `MetaAdsPort.generateAdCopy`; this tool
 * only branches on the outcome.
 *
 * Two states the old shape could not tell apart, and now must:
 *   - `rejected_by_content_rules` — the generator worked and its copy kept
 *     tripping a content rule (percentage discount, quantified outcome claim,
 *     banned phrase, POM brand). The owner needs to know their ask hit a rule.
 *   - `blocked` — the call failed. Nothing to do with content.
 */
export const generateAdCopyTool = defineTool<
  { videoId: string; serviceIds?: string[]; includeOffer?: boolean },
  GenerateAdCopyOutput
>({
  feature: 'meta-ads',
  action: 'generateAdCopy',
  description:
    'AI-generate ad copy (headline, primary text, description, call-to-action) ' +
    'for a video ad. Uses the organization brand voice and service context. ' +
    'Defaults to value-led copy without a price. Set includeOffer only when ' +
    'the owner explicitly wants an intro-offer ad. Call this before ' +
    'createDraftAd to pre-fill creative fields.',
  inputSchema: z.object({
    videoId: z.string().min(1).describe('Video ID to generate ad copy for'),
    serviceIds: z
      .array(z.string().min(1))
      .optional()
      .describe('Service IDs for context matching'),
    includeOffer: z
      .boolean()
      .optional()
      .describe(
        'Explicitly request price-led intro-offer copy. Omit for value-led copy.'
      ),
  }),
  destructive: false,
  preferredModel: 'sonnet',
  presentation: { statusLabel: 'Drafting ad copy' },
  execute: async ({ videoId, serviceIds, includeOffer }, ctx) => {
    const result = await ctx.ports.metaAds.generateAdCopy({
      videoId,
      serviceIds,
      includeOffer,
    });

    if (result.status === 'generated') {
      return { data: { ...result.copy } };
    }

    if (result.status === 'rejected_by_content_rules') {
      const detail = result.violations
        .map(
          (v) =>
            `${v.field}: ${v.reason}${v.matched ? ` ("${v.matched}")` : ''}`
        )
        .join('; ');
      return {
        data: {
          error: `I couldn't write compliant copy for this one after ${result.attempts} attempts — it kept including a percentage discount or a quantified/fabricated result claim${detail ? ` (${detail})` : ''}. Ask me again without a discount or results angle, or write the copy yourself.`,
        },
      };
    }

    if (result.reason.kind === 'server_error') {
      ctx.reportIssue('Failed to generate ad copy', {
        extra: { videoId, reason: result.reason },
      });
    }
    return { data: { error: describeAdCopyBlocked(result.reason) } };
  },
});
