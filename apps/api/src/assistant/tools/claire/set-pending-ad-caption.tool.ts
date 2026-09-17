import { db } from '@borradh-workspace/database';
import {
  getOrCreateDraftAd,
  updateDraftAd,
} from '@borradh-workspace/features/claire';
import { z } from 'zod';
import { defineTool } from '../../tool-factory/index.js';
import { adToSnapshot } from './_helpers.js';
import type { DraftAdSnapshot } from './types.js';

/**
 * The "caption" on a Meta ad maps to `primaryText` — the long-form body
 * that sits above the headline. Confusing terminology is upstream Meta's;
 * we expose "caption" in the tool description so the model uses natural
 * vocabulary with the user.
 */
export const setPendingAdCaptionTool = defineTool<
  { caption: string },
  DraftAdSnapshot | { error: string }
>({
  feature: 'claire',
  action: 'setPendingAdCaption',
  description:
    'Override the caption (Meta calls this "primary text") on the current draft ad. Max 500 chars. This is the long-form body that sits above the headline.',
  inputSchema: z.object({
    caption: z.string().min(1).max(500),
  }),
  destructive: false,
  preferredModel: 'sonnet',
  presentation: { statusLabel: 'Updating ad caption' },
  execute: async (input, ctx) => {
    const draft = await getOrCreateDraftAd(db, {
      organizationId: ctx.organizationId,
      conversationId: ctx.conversationId,
    });
    if (!draft.success) return { data: { error: draft.error.message } };
    const updated = await updateDraftAd(db, {
      organizationId: ctx.organizationId,
      draftId: draft.data.ad.id,
      update: { primaryText: input.caption },
    });
    if (!updated.success) return { data: { error: updated.error.message } };
    return { data: adToSnapshot(updated.data.ad, updated.data.serviceIds) };
  },
});
