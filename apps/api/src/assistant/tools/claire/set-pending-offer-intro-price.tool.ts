import { db, offerDiscountTypeValues } from '@borradh-workspace/database';
import {
  getOrCreateDraftOffer,
  updateDraftOffer,
} from '@borradh-workspace/features/claire';
import { z } from 'zod';
import { defineTool } from '../../tool-factory/index.js';
import { offerToSnapshot } from './_helpers.js';
import type { DraftOfferSnapshot } from './types.js';

const introPriceInputSchema = z
  .object({
    discountType: z.enum(offerDiscountTypeValues),
    discountPercent: z.number().int().min(1).max(100).optional(),
    offerPriceCents: z.number().int().min(0).optional(),
    originalPriceCents: z.number().int().min(0).optional(),
    buyQuantity: z.number().int().min(1).optional(),
    getQuantity: z.number().int().min(1).optional(),
  })
  .superRefine((data, ctx) => {
    if (data.discountType === 'percentage' && data.discountPercent == null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['discountPercent'],
        message: 'discountPercent is required for percentage discounts',
      });
    }
    if (data.discountType === 'fixed_price' && data.offerPriceCents == null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['offerPriceCents'],
        message: 'offerPriceCents is required for fixed_price discounts',
      });
    }
    if (data.discountType === 'buy_x_get_y') {
      if (data.buyQuantity == null) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['buyQuantity'],
          message: 'buyQuantity is required for buy_x_get_y discounts',
        });
      }
      if (data.getQuantity == null) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['getQuantity'],
          message: 'getQuantity is required for buy_x_get_y discounts',
        });
      }
    }
  });

type IntroPriceInput = z.infer<typeof introPriceInputSchema>;

/**
 * `claire_setPendingOfferIntroPrice` — pin the discount shape on the
 * draft offer. Discriminated by `discountType`; only the relevant
 * companion fields need to be passed.
 */
export const setPendingOfferIntroPriceTool = defineTool<
  IntroPriceInput,
  DraftOfferSnapshot | { error: string }
>({
  feature: 'claire',
  action: 'setPendingOfferIntroPrice',
  description:
    'Override the offer price (or discount percent for percentage discounts) on the current draft. Pass `discountType` plus the matching companion fields: discountPercent (percentage), offerPriceCents + optional originalPriceCents (fixed_price), or buyQuantity + getQuantity (buy_x_get_y).',
  inputSchema: introPriceInputSchema,
  destructive: false,
  preferredModel: 'sonnet',
  presentation: { statusLabel: 'Updating offer pricing' },
  execute: async (input, ctx) => {
    const draft = await getOrCreateDraftOffer(db, {
      organizationId: ctx.organizationId,
      conversationId: ctx.conversationId,
    });
    if (!draft.success) return { data: { error: draft.error.message } };

    // Null out the columns that don't apply to the chosen discount type
    // so the row remains consistent (no stale percent + price combo).
    const update = {
      discountType: input.discountType,
      discountPercent:
        input.discountType === 'percentage'
          ? (input.discountPercent ?? null)
          : null,
      offerPriceCents:
        input.discountType === 'fixed_price'
          ? (input.offerPriceCents ?? null)
          : null,
      originalPriceCents:
        input.discountType === 'fixed_price'
          ? (input.originalPriceCents ?? null)
          : null,
      buyQuantity:
        input.discountType === 'buy_x_get_y'
          ? (input.buyQuantity ?? null)
          : null,
      getQuantity:
        input.discountType === 'buy_x_get_y'
          ? (input.getQuantity ?? null)
          : null,
    } satisfies Parameters<typeof updateDraftOffer>[1]['update'];

    const updated = await updateDraftOffer(db, {
      organizationId: ctx.organizationId,
      draftId: draft.data.offer.id,
      update,
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
