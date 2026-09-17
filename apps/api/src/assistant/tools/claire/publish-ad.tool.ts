import { db } from '@borradh-workspace/database';
import {
  endCycle,
  getOrCreateDraftAd,
  promoteDraftAd,
} from '@borradh-workspace/features/claire';
import { z } from 'zod';
import { defineTool } from '../../tool-factory/index.js';
import { emitCyclePublishedEvent } from './_helpers.js';

interface PublishedAdResult {
  adId: string;
  metaCampaignId: string;
  metaAdSetId: string;
  status: string;
  /**
   * Truthful description of where the launch actually is. `promoteDraftAd`
   * only QUEUES the launch (the row is `status: 'launching'`); upload,
   * creative build, Meta review and activation all happen in the background
   * finalizer, which then persists the state read back from Meta (ADR-005).
   * The ad must never be reported as live from this tool's result.
   */
  message: string;
}

/**
 * `claire_publishAd` — promote the draft to a live launch. Destructive.
 *
 * Two-call confirmation flow via the factory: the operator must click
 * Publish on the preview card, which echoes back the token. Without
 * the token, the tool emits `confirmation_required` for the chat
 * surface to enforce. The preview card (Window 7) holds the actual
 * Publish button — Claire never publishes from free-text reasoning.
 */
export const publishAdTool = defineTool<
  { draftId: string; confirmationToken?: string },
  PublishedAdResult
>({
  feature: 'claire',
  action: 'publishAd',
  description:
    'Publish the current draft ad. Use only after the user has clicked Publish in the preview card. Queues the Meta launch: upload, review and activation happen in the background, so the result status is "launching" — NOT live. Report exactly that; never tell the user the ad is live from this result.',
  inputSchema: z.object({
    draftId: z.string().min(1),
    confirmationToken: z.string().optional(),
  }),
  destructive: true,
  destructiveAction: 'launch_ad',
  preferredModel: 'sonnet',
  presentation: {
    statusLabel: 'Publishing ad',
    confirmationRenderer: 'AdPublishConfirmation',
  },
  summarizeForConfirmation: async (input, ctx) => {
    // Snapshot the draft so the confirmation summary reflects the actual
    // state at the moment the operator clicked Publish.
    const draft = await getOrCreateDraftAd(db, {
      organizationId: ctx.organizationId,
      conversationId: ctx.conversationId,
    });
    if (!draft.success || draft.data.ad.id !== input.draftId) {
      return {
        resourceId: input.draftId,
        title: 'Publish draft ad',
        fields: [{ label: 'Draft', value: input.draftId }],
      };
    }
    return {
      resourceId: input.draftId,
      title: `Publish "${draft.data.ad.name}"`,
      fields: [
        { label: 'Name', value: draft.data.ad.name },
        ...(draft.data.ad.headline
          ? [{ label: 'Headline', value: draft.data.ad.headline }]
          : []),
        ...(draft.data.ad.metaCampaignId
          ? [
              {
                label: 'Campaign',
                value: draft.data.ad.metaCampaignId,
              },
            ]
          : []),
      ],
      payload: { draftId: input.draftId },
    };
  },
  execute: async (input, ctx) => {
    const promoted = await promoteDraftAd(db, {
      organizationId: ctx.organizationId,
      draftId: input.draftId,
    });
    if (!promoted.success) {
      throw new Error(promoted.error.message);
    }
    // Emit the funnel `published` event BEFORE endCycle so the cycle
    // metadata (acceptedAtRank, impressionAt) is still readable. The
    // helper is fire-and-forget; promoteDraftAd has already committed.
    await emitCyclePublishedEvent({
      organizationId: ctx.organizationId,
      conversationId: ctx.conversationId,
      kind: 'ad_flow_service_pick',
      publishedAdId: promoted.data.ad.id,
    });
    // Close the push-memory cycle so the next ad-creation intent opens a
    // fresh one. Failure is non-fatal — the ad is launched.
    await endCycle(db, {
      organizationId: ctx.organizationId,
      conversationId: ctx.conversationId,
      kind: 'ad_flow_service_pick',
      resolution: 'actioned',
    });
    return {
      data: {
        adId: promoted.data.ad.id,
        metaCampaignId: promoted.data.metaCampaignId,
        metaAdSetId: promoted.data.metaAdSetId,
        status: promoted.data.ad.status,
        message:
          'The launch has been queued. Meta upload, review and activation run in the background — the ad is NOT live yet. Its real status (live, in review, rejected, or campaign-paused) is verified against Meta when the background launch finishes.',
      },
    };
  },
});
