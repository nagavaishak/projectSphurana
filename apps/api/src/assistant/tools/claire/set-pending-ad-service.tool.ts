import { db } from '@borradh-workspace/database';
import {
  getBusinessProfile,
  getOrCreateDraftAd,
  markCycleAccepted,
  recomputeRanking,
  trackRecommendationAccepted,
  updateDraftAd,
} from '@borradh-workspace/features/claire';
import { listServicesForOrg } from '@borradh-workspace/features/organization-services';
import { z } from 'zod';
import { defineTool } from '../../tool-factory/index.js';
import { adToSnapshot } from './_helpers.js';
import type { DraftAdSnapshot } from './types.js';

/**
 * `claire_setPendingAdService` — set the service being advertised in the
 * current draft ad. Creates the draft on first call with every other field
 * pre-populated from Claire's recommendation (headline/primaryText/CTA).
 *
 * Subsequent calls (service swap mid-conversation) refresh the cascaded
 * defaults — the per-field override tools (`set_pending_ad_price`,
 * `set_pending_ad_copy` etc.) then layer on top.
 */
export const setPendingAdServiceTool = defineTool<
  { serviceId: string },
  DraftAdSnapshot | { error: string }
>({
  feature: 'claire',
  action: 'setPendingAdService',
  description:
    'Set the service being advertised in the current draft ad. Creates the draft if it does not exist yet. Populates ALL other fields with Claire-recommended defaults (intro price, copy, schedule, targeting). Subsequent set_pending_ad_* tools should only be called to OVERRIDE specific defaults the user explicitly changes.',
  inputSchema: z.object({
    serviceId: z.string().min(1),
  }),
  destructive: false,
  preferredModel: 'sonnet',
  presentation: { statusLabel: 'Pinning the service to advertise' },
  execute: async (input, ctx) => {
    const draft = await getOrCreateDraftAd(db, {
      organizationId: ctx.organizationId,
      conversationId: ctx.conversationId,
      serviceId: input.serviceId,
    });
    if (!draft.success) {
      return { data: { error: draft.error.message } };
    }

    // If the draft already exists with a different service, swap it +
    // cascade defaults. If it's already on this service, no-op.
    if (
      draft.data.serviceIds.length === 1 &&
      draft.data.serviceIds[0] === input.serviceId
    ) {
      return { data: adToSnapshot(draft.data.ad, draft.data.serviceIds) };
    }

    const updated = await updateDraftAd(db, {
      organizationId: ctx.organizationId,
      draftId: draft.data.ad.id,
      update: { serviceIds: [input.serviceId] },
      cascadeDefaults: true,
    });
    if (!updated.success) {
      return { data: { error: updated.error.message } };
    }

    // If the chosen service is one of Claire's ranked picks, record the
    // accept on the cycle (so promote/save events can compute funnel metrics)
    // and fire the PostHog event. Services NOT in the ranked list still
    // create drafts but aren't part of the recommendation funnel.
    const profile = await getBusinessProfile(db, {
      organizationId: ctx.organizationId,
    });
    const servicesResult = await listServicesForOrg(db, {
      organizationId: ctx.organizationId,
    });
    if (profile.success && servicesResult.success) {
      const ranked = recomputeRanking(profile.data, servicesResult.data).find(
        (r) => r.serviceId === input.serviceId
      );
      if (ranked) {
        await markCycleAccepted(db, {
          organizationId: ctx.organizationId,
          conversationId: ctx.conversationId,
          kind: 'ad_flow_service_pick',
          acceptedAtRank: ranked.rank,
        });
        trackRecommendationAccepted(ctx.organizationId, {
          surface: 'chat',
          kind: 'ad_flow_service_pick',
          rankedServiceId: ranked.serviceId,
          rank: ranked.rank,
          acceptedAtRank: ranked.rank,
          marketPosition: profile.data.marketPosition,
          offerStrategy: ranked.offerStrategy,
        });
      }
    }

    return { data: adToSnapshot(updated.data.ad, updated.data.serviceIds) };
  },
});
