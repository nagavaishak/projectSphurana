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
 * `claire_setPendingAdTargeting` — set the audience targeting on the
 * draft ad: how far, which ages, which genders.
 *
 * NO COORDINATES. The area is the business's saved, geocoded branch and is
 * resolved server-side at publish time — see
 * `features/meta-campaigns/services/_shared/resolve-campaign-location.ts` for
 * why an ad targeted at Null Island made that non-negotiable.
 *
 * The Zod schema accepts partial values so the user can build targeting up
 * across multiple turns; the launch step does the final validation.
 */
export const setPendingAdTargetingTool = defineTool<
  {
    distanceKm?: number;
    ageMin?: number;
    ageMax?: number;
    genders?: number[];
    countries?: string[];
  },
  DraftAdSnapshot | { error: string }
>({
  feature: 'claire',
  action: 'setPendingAdTargeting',
  description:
    "Set audience targeting on the draft ad: distanceKm (radius from the business's saved address), optional age range (18-65), genders (1=male, 2=female), or a list of ISO country codes for national targeting. You cannot set the area itself — it is always the saved address. The fields you do not pass keep their existing values.",
  inputSchema: z.object({
    distanceKm: z.number().min(1).max(500).optional(),
    ageMin: z.number().min(18).max(65).optional(),
    ageMax: z.number().min(18).max(65).optional(),
    genders: z.array(z.number().min(1).max(2)).optional(),
    countries: z.array(z.string().length(2)).optional(),
  }),
  destructive: false,
  preferredModel: 'sonnet',
  presentation: { statusLabel: 'Updating audience targeting' },
  execute: async (input, ctx) => {
    const draft = await getOrCreateDraftAd(db, {
      organizationId: ctx.organizationId,
      conversationId: ctx.conversationId,
    });
    if (!draft.success) return { data: { error: draft.error.message } };

    // Merge with existing targeting so partial updates don't blow it away.
    const existing = (draft.data.ad.targetingOverride ?? {}) as Record<
      string,
      unknown
    >;
    const merged = { ...existing, ...input };

    const updated = await updateDraftAd(db, {
      organizationId: ctx.organizationId,
      draftId: draft.data.ad.id,
      update: { targetingOverride: merged },
    });
    if (!updated.success) return { data: { error: updated.error.message } };
    return { data: adToSnapshot(updated.data.ad, updated.data.serviceIds) };
  },
});
