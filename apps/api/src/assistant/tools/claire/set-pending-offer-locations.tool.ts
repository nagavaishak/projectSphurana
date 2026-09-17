import { db } from '@borradh-workspace/database';
import {
  getOrCreateDraftOffer,
  updateDraftOffer,
} from '@borradh-workspace/features/claire';
import { z } from 'zod';
import { defineTool } from '../../tool-factory/index.js';
import { offerToSnapshot } from './_helpers.js';
import type { DraftOfferSnapshot } from './types.js';

export const setPendingOfferLocationsTool = defineTool<
  { locationIds: string[] },
  DraftOfferSnapshot | { error: string }
>({
  feature: 'claire',
  action: 'setPendingOfferLocations',
  description:
    'Set the locations the offer applies to. Empty array means all org locations. Pass the ids surfaced by list-locations — invalid ids surface as 4xx at publish time.',
  inputSchema: z.object({
    locationIds: z.array(z.string().min(1)),
  }),
  destructive: false,
  preferredModel: 'sonnet',
  presentation: { statusLabel: 'Updating offer locations' },
  execute: async (input, ctx) => {
    const draft = await getOrCreateDraftOffer(db, {
      organizationId: ctx.organizationId,
      conversationId: ctx.conversationId,
    });
    if (!draft.success) return { data: { error: draft.error.message } };
    const updated = await updateDraftOffer(db, {
      organizationId: ctx.organizationId,
      draftId: draft.data.offer.id,
      update: { locationIds: input.locationIds },
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
