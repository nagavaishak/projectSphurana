import { db } from '@borradh-workspace/database';
import {
  getOrCreateDraftAd,
  updateDraftAd,
} from '@borradh-workspace/features/claire';
import { z } from 'zod';
import { defineTool } from '../../tool-factory/index.js';
import { adToSnapshot } from './_helpers.js';
import type { DraftAdSnapshot } from './types.js';

export const setPendingAdHeadlineTool = defineTool<
  { headline: string },
  DraftAdSnapshot | { error: string }
>({
  feature: 'claire',
  action: 'setPendingAdHeadline',
  description:
    'Override the headline on the current draft ad (max 80 chars). The headline is the bold text shown above the ad creative.',
  inputSchema: z.object({
    headline: z.string().min(1).max(80),
  }),
  destructive: false,
  preferredModel: 'sonnet',
  presentation: { statusLabel: 'Updating ad headline' },
  execute: async (input, ctx) => {
    const draft = await getOrCreateDraftAd(db, {
      organizationId: ctx.organizationId,
      conversationId: ctx.conversationId,
    });
    if (!draft.success) {
      return { data: { error: draft.error.message } };
    }
    const updated = await updateDraftAd(db, {
      organizationId: ctx.organizationId,
      draftId: draft.data.ad.id,
      update: { headline: input.headline },
    });
    if (!updated.success) return { data: { error: updated.error.message } };
    return { data: adToSnapshot(updated.data.ad, updated.data.serviceIds) };
  },
});
