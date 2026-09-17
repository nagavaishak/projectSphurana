import { db } from '@borradh-workspace/database';
import { endCycle } from '@borradh-workspace/features/claire';
import { z } from 'zod';
import { defineTool } from '../../tool-factory/index.js';
import { emitCycleDraftSavedEvent } from './_helpers.js';

export const saveOfferDraftTool = defineTool<
  { draftId: string },
  { draftId: string; saved: boolean }
>({
  feature: 'claire',
  action: 'saveOfferDraft',
  description:
    'Save the current draft offer without publishing. Use after the user has clicked Save Draft on the preview card.',
  inputSchema: z.object({
    draftId: z.string().min(1),
  }),
  destructive: false,
  preferredModel: 'sonnet',
  presentation: { statusLabel: 'Saving offer draft' },
  execute: async (input, ctx) => {
    await emitCycleDraftSavedEvent({
      organizationId: ctx.organizationId,
      conversationId: ctx.conversationId,
      kind: 'ad_flow_offer_pick',
      draftId: input.draftId,
    });
    await endCycle(db, {
      organizationId: ctx.organizationId,
      conversationId: ctx.conversationId,
      kind: 'ad_flow_offer_pick',
      resolution: 'actioned',
    });
    return { data: { draftId: input.draftId, saved: true } };
  },
});
