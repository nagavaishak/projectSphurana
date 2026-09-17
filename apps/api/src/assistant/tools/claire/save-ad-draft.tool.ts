import { db } from '@borradh-workspace/database';
import { endCycle } from '@borradh-workspace/features/claire';
import { z } from 'zod';
import { defineTool } from '../../tool-factory/index.js';
import { emitCycleDraftSavedEvent } from './_helpers.js';

/**
 * `claire_saveAdDraft` — keep the draft as-is (state stays `'draft'`)
 * and close the push-memory cycle so the next ad-creation intent opens
 * a fresh one.
 *
 * Non-destructive: there's no Meta API call. The draft persists
 * indefinitely; the dashboard surfaces it for re-opening later.
 */
export const saveAdDraftTool = defineTool<
  { draftId: string },
  { draftId: string; saved: boolean }
>({
  feature: 'claire',
  action: 'saveAdDraft',
  description:
    'Save the current draft ad without publishing. Use after the user has clicked Save Draft on the preview card.',
  inputSchema: z.object({
    draftId: z.string().min(1),
  }),
  destructive: false,
  preferredModel: 'sonnet',
  presentation: { statusLabel: 'Saving draft' },
  execute: async (input, ctx) => {
    await emitCycleDraftSavedEvent({
      organizationId: ctx.organizationId,
      conversationId: ctx.conversationId,
      kind: 'ad_flow_service_pick',
      draftId: input.draftId,
    });
    await endCycle(db, {
      organizationId: ctx.organizationId,
      conversationId: ctx.conversationId,
      kind: 'ad_flow_service_pick',
      // 'actioned' rather than 'dismissed' — user took deliberate action,
      // just didn't publish yet.
      resolution: 'actioned',
    });
    return { data: { draftId: input.draftId, saved: true } };
  },
});
