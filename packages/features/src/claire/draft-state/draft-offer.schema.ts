import {
  offerDiscountTypeValues,
  offerStateValues,
} from '@borradh-workspace/labels';
import { z } from 'zod';

export const getOrCreateDraftOfferSchema = z.object({
  organizationId: z.string().min(1),
  conversationId: z.string().min(1),
  // When omitted, defaults to rankedServices[topPick].
  serviceId: z.string().min(1).optional(),
});

export type GetOrCreateDraftOfferInput = z.infer<
  typeof getOrCreateDraftOfferSchema
>;

/**
 * Per-field update shape for draft offers. The `serviceIds` / `locationIds`
 * arrays REPLACE the existing junction rows when present.
 */
export const draftOfferUpdateShape = z.object({
  name: z.string().min(1).max(200).optional(),
  code: z.string().max(40).nullable().optional(),
  state: z.enum(offerStateValues).optional(),
  discountType: z.enum(offerDiscountTypeValues).optional(),
  discountPercent: z.number().int().min(1).max(100).nullable().optional(),
  originalPriceCents: z.number().int().min(0).nullable().optional(),
  offerPriceCents: z.number().int().min(0).nullable().optional(),
  buyQuantity: z.number().int().min(1).nullable().optional(),
  getQuantity: z.number().int().min(1).nullable().optional(),
  limitPerClient: z.boolean().optional(),
  redemptionLimit: z.number().int().min(1).nullable().optional(),
  validFrom: z.coerce.date().nullable().optional(),
  validUntil: z.coerce.date().nullable().optional(),
  serviceIds: z.array(z.string().min(1)).min(1).optional(),
  locationIds: z.array(z.string().min(1)).optional(),
});

export const updateDraftOfferSchema = z.object({
  organizationId: z.string().min(1),
  draftId: z.string().min(1),
  update: draftOfferUpdateShape,
  cascadeDefaults: z.boolean().optional().default(false),
});

export type UpdateDraftOfferInput = z.input<typeof updateDraftOfferSchema>;

export const promoteDraftOfferSchema = z.object({
  organizationId: z.string().min(1),
  draftId: z.string().min(1),
});

export type PromoteDraftOfferInput = z.infer<typeof promoteDraftOfferSchema>;
