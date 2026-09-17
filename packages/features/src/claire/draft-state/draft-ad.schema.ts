import {
  adPlacementValues,
  followUpTypeValues,
  metaCallToActionValues,
} from '@borradh-workspace/labels';
import { z } from 'zod';
import { adTargetingOverrideSchema } from '../../meta-ads/services/create-ad/create-ad.schema.js';

export const getOrCreateDraftAdSchema = z.object({
  organizationId: z.string().min(1),
  conversationId: z.string().min(1),
  // When omitted, defaults to rankedServices[topPick]. Caller may pass a
  // specific service id (alternative) — service must exist in rankedServices.
  serviceId: z.string().min(1).optional(),
  // Required only when an existing draft isn't found AND the org has no
  // metaCampaign yet. The first-time-creation path needs a campaign to
  // attach to; the test plan uses a stub campaign id, prod prompts the
  // user for a campaign before publish.
  metaCampaignId: z.string().min(1).optional(),
});

export type GetOrCreateDraftAdInput = z.infer<typeof getOrCreateDraftAdSchema>;

/**
 * Per-field update shape. Mirrors `metaAd` columns that Window-6 tools
 * mutate via `set_pending_ad_*` tools. Fields the user can NEVER override
 * via chat (organizationId, status, etc.) are omitted.
 */
export const draftAdUpdateShape = z.object({
  name: z.string().min(1).max(255).optional(),
  serviceIds: z.array(z.string().min(1)).min(1).optional(),
  headline: z.string().max(80).optional(),
  primaryText: z.string().max(500).optional(),
  description: z.string().max(30).optional(),
  callToAction: z.enum(metaCallToActionValues).optional(),
  destinationUrl: z.string().url().optional(),
  targetingOverride: adTargetingOverrideSchema,
  followUpType: z.enum(followUpTypeValues).optional(),
  adPlacement: z.enum(adPlacementValues).optional(),
  metaAdsPageId: z.string().min(1).optional(),
  videoId: z.string().min(1).optional(),
  /** Image creative — references a rendered `graphic.id` (offer ad graphic). */
  graphicId: z.string().min(1).optional(),
  metaCampaignId: z.string().min(1).optional(),
});

export const updateDraftAdSchema = z.object({
  organizationId: z.string().min(1),
  draftId: z.string().min(1),
  update: draftAdUpdateShape,
  // When the underlying service changes, refresh derived defaults (copy,
  // CTA, suggested price). Only `set_pending_ad_service` sets this.
  cascadeDefaults: z.boolean().optional().default(false),
});

export type UpdateDraftAdInput = z.input<typeof updateDraftAdSchema>;

export const promoteDraftAdSchema = z.object({
  organizationId: z.string().min(1),
  draftId: z.string().min(1),
});

export type PromoteDraftAdInput = z.infer<typeof promoteDraftAdSchema>;
