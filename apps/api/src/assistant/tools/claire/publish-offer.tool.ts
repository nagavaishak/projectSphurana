import { db } from '@borradh-workspace/database';
import {
  endCycle,
  getOrCreateDraftOffer,
  promoteDraftOffer,
} from '@borradh-workspace/features/claire';
import { z } from 'zod';
import { defineTool } from '../../tool-factory/index.js';
import { emitCyclePublishedEvent } from './_helpers.js';

export const publishOfferTool = defineTool<
  { draftId: string; confirmationToken?: string },
  { offerId: string; state: string; name: string }
>({
  feature: 'claire',
  action: 'publishOffer',
  description:
    'Publish the current draft offer — flips state from draft to active. Use only after the operator has clicked Publish on the preview card.',
  inputSchema: z.object({
    draftId: z.string().min(1),
    confirmationToken: z.string().optional(),
  }),
  destructive: true,
  destructiveAction: 'create_offer',
  preferredModel: 'sonnet',
  presentation: {
    statusLabel: 'Publishing offer',
    confirmationRenderer: 'OfferPublishConfirmation',
  },
  summarizeForConfirmation: async (input, ctx) => {
    const draft = await getOrCreateDraftOffer(db, {
      organizationId: ctx.organizationId,
      conversationId: ctx.conversationId,
    });
    if (!draft.success || draft.data.offer.id !== input.draftId) {
      return {
        resourceId: input.draftId,
        title: 'Publish draft offer',
        fields: [{ label: 'Draft', value: input.draftId }],
      };
    }
    return {
      resourceId: input.draftId,
      title: `Publish offer "${draft.data.offer.name}"`,
      fields: [
        { label: 'Name', value: draft.data.offer.name },
        { label: 'Discount type', value: draft.data.offer.discountType },
        ...(draft.data.offer.code
          ? [{ label: 'Code', value: draft.data.offer.code }]
          : []),
        ...(draft.data.offer.validUntil
          ? [
              {
                label: 'Valid until',
                value: draft.data.offer.validUntil.toISOString(),
              },
            ]
          : []),
      ],
      payload: { draftId: input.draftId },
    };
  },
  execute: async (input, ctx) => {
    const promoted = await promoteDraftOffer(db, {
      organizationId: ctx.organizationId,
      draftId: input.draftId,
    });
    if (!promoted.success) {
      throw new Error(promoted.error.message);
    }
    await emitCyclePublishedEvent({
      organizationId: ctx.organizationId,
      conversationId: ctx.conversationId,
      kind: 'ad_flow_offer_pick',
      publishedOfferId: promoted.data.id,
    });
    await endCycle(db, {
      organizationId: ctx.organizationId,
      conversationId: ctx.conversationId,
      kind: 'ad_flow_offer_pick',
      resolution: 'actioned',
    });
    return {
      data: {
        offerId: promoted.data.id,
        state: promoted.data.state,
        name: promoted.data.name,
      },
    };
  },
});
