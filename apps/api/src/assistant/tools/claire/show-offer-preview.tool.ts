import { db } from '@borradh-workspace/database';
import { getOrCreateDraftOffer } from '@borradh-workspace/features/claire';
import { z } from 'zod';
import { defineTool } from '../../tool-factory/index.js';
import { offerToSnapshot } from './_helpers.js';
import type { PreviewCardPayload } from './types.js';

export const showOfferPreviewTool = defineTool<
  Record<string, never>,
  { draftId: string; ready: boolean; missing: string[] }
>({
  feature: 'claire',
  action: 'showOfferPreview',
  description:
    'Render the offer preview card in the chat with the current draft state. Call this once name + discount shape + validity are set. The card shows the configured offer + Publish/Save Draft buttons.',
  inputSchema: z.object({}),
  destructive: false,
  preferredModel: 'sonnet',
  presentation: { statusLabel: 'Rendering the offer preview' },
  execute: async (_input, ctx) => {
    const draft = await getOrCreateDraftOffer(db, {
      organizationId: ctx.organizationId,
      conversationId: ctx.conversationId,
    });
    if (!draft.success) {
      return {
        data: { draftId: '', ready: false, missing: [draft.error.message] },
      };
    }

    const snapshot = offerToSnapshot(
      draft.data.offer,
      draft.data.serviceIds,
      draft.data.locationIds
    );

    const missing: string[] = [];
    if (!snapshot.validUntil) missing.push('validUntil');
    if (
      snapshot.discountType === 'percentage' &&
      snapshot.discountPercent == null
    ) {
      missing.push('discountPercent');
    }
    if (
      snapshot.discountType === 'fixed_price' &&
      snapshot.offerPriceCents == null
    ) {
      missing.push('offerPriceCents');
    }
    if (
      snapshot.discountType === 'buy_x_get_y' &&
      (snapshot.buyQuantity == null || snapshot.getQuantity == null)
    ) {
      missing.push('buyQuantity/getQuantity');
    }

    const payload: PreviewCardPayload = {
      type: 'preview_card',
      kind: 'offer',
      draftId: draft.data.offer.id,
      state: snapshot as unknown as Record<string, unknown>,
    };

    return {
      data: {
        draftId: draft.data.offer.id,
        ready: missing.length === 0,
        missing,
      },
      presentation: payload,
    };
  },
});
