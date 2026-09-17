import { db } from '@borradh-workspace/database';
import {
  getOrCreateDraftOffer,
  updateDraftOffer,
} from '@borradh-workspace/features/claire';
import { z } from 'zod';
import { defineTool } from '../../tool-factory/index.js';
import { offerToSnapshot } from './_helpers.js';
import type { DraftOfferSnapshot } from './types.js';

export const setPendingOfferNameTool = defineTool<
  { name: string },
  DraftOfferSnapshot | { error: string }
>({
  feature: 'claire',
  action: 'setPendingOfferName',
  description:
    'Override the offer name (defaults to "{service} intro"). Internal label only — clients never see this; it appears in the dashboard.',
  inputSchema: z.object({
    name: z.string().min(1).max(200),
  }),
  destructive: false,
  preferredModel: 'sonnet',
  presentation: { statusLabel: 'Renaming the offer' },
  execute: async (input, ctx) => {
    const draft = await getOrCreateDraftOffer(db, {
      organizationId: ctx.organizationId,
      conversationId: ctx.conversationId,
    });
    if (!draft.success) return { data: { error: draft.error.message } };
    const updated = await updateDraftOffer(db, {
      organizationId: ctx.organizationId,
      draftId: draft.data.offer.id,
      update: { name: input.name },
    });
    if (!updated.success) return { data: { error: updated.error.message } };
    return {
      data: offerToSnapshot(
        updated.data.offer,
        updated.data.serviceIds,
        updated.data.locationIds
      ),
    };
  },
});
