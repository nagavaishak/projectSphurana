import { db } from '@borradh-workspace/database';
import {
  getOrCreateDraftOffer,
  updateDraftOffer,
} from '@borradh-workspace/features/claire';
import { z } from 'zod';
import { defineTool } from '../../tool-factory/index.js';
import { offerToSnapshot } from './_helpers.js';
import type { DraftOfferSnapshot } from './types.js';

export const setPendingOfferValidityTool = defineTool<
  { validFrom?: string | null; validUntil: string },
  DraftOfferSnapshot | { error: string }
>({
  feature: 'claire',
  action: 'setPendingOfferValidity',
  description:
    'Set validFrom and validUntil on the current draft offer (ISO date strings). Pass validFrom as null to mean "valid from creation". validUntil is required.',
  inputSchema: z.object({
    validFrom: z.string().nullable().optional(),
    validUntil: z.string().min(1),
  }),
  destructive: false,
  preferredModel: 'sonnet',
  presentation: { statusLabel: 'Setting offer validity' },
  execute: async (input, ctx) => {
    const draft = await getOrCreateDraftOffer(db, {
      organizationId: ctx.organizationId,
      conversationId: ctx.conversationId,
    });
    if (!draft.success) return { data: { error: draft.error.message } };

    const validFromValue =
      input.validFrom === undefined || input.validFrom === null
        ? null
        : new Date(input.validFrom);
    const validUntilValue = new Date(input.validUntil);

    if (validFromValue && Number.isNaN(validFromValue.getTime())) {
      return { data: { error: 'validFrom is not a valid date.' } };
    }
    if (Number.isNaN(validUntilValue.getTime())) {
      return { data: { error: 'validUntil is not a valid date.' } };
    }

    const updated = await updateDraftOffer(db, {
      organizationId: ctx.organizationId,
      draftId: draft.data.offer.id,
      update: {
        validFrom: validFromValue,
        validUntil: validUntilValue,
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
