import { db } from '@borradh-workspace/database';
import {
  getOrCreateDraftOffer,
  updateDraftOffer,
} from '@borradh-workspace/features/claire';
import { z } from 'zod';
import { defineTool } from '../../tool-factory/index.js';
import { offerToSnapshot } from './_helpers.js';
import type { DraftOfferSnapshot } from './types.js';

export const setPendingOfferRedemptionRulesTool = defineTool<
  { limitPerClient: boolean; redemptionLimit?: number | null },
  DraftOfferSnapshot | { error: string }
>({
  feature: 'claire',
  action: 'setPendingOfferRedemptionRules',
  description:
    'Configure redemption rules: limitPerClient (boolean — cap each client to a single redemption) and redemptionLimit (total cap across all clients; omit or null for no cap). Per-client enforcement happens at redemption time via phone/email.',
  inputSchema: z.object({
    limitPerClient: z.boolean(),
    redemptionLimit: z.number().int().min(1).nullable().optional(),
  }),
  destructive: false,
  preferredModel: 'sonnet',
  presentation: { statusLabel: 'Updating redemption rules' },
  execute: async (input, ctx) => {
    const draft = await getOrCreateDraftOffer(db, {
      organizationId: ctx.organizationId,
      conversationId: ctx.conversationId,
    });
    if (!draft.success) return { data: { error: draft.error.message } };

    const updated = await updateDraftOffer(db, {
      organizationId: ctx.organizationId,
      draftId: draft.data.offer.id,
      update: {
        limitPerClient: input.limitPerClient,
        redemptionLimit:
          input.redemptionLimit === undefined ? null : input.redemptionLimit,
      },
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
