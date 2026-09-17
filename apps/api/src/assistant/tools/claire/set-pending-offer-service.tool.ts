import { db } from '@borradh-workspace/database';
import {
  getBusinessProfile,
  getOrCreateDraftOffer,
  markCycleAccepted,
  recomputeRanking,
  trackRecommendationAccepted,
  updateDraftOffer,
} from '@borradh-workspace/features/claire';
import { listServicesForOrg } from '@borradh-workspace/features/organization-services';
import { z } from 'zod';
import { defineTool } from '../../tool-factory/index.js';
import { offerToSnapshot } from './_helpers.js';
import type { DraftOfferSnapshot } from './types.js';

export const setPendingOfferServiceTool = defineTool<
  { serviceId: string },
  DraftOfferSnapshot | { error: string }
>({
  feature: 'claire',
  action: 'setPendingOfferService',
  description:
    'Set the primary service for the current draft offer. Creates the draft if it does not exist, populating ALL fields with Claire-recommended defaults (name, intro price, validity, etc.). Replaces serviceIds[] with [serviceId].',
  inputSchema: z.object({
    serviceId: z.string().min(1),
  }),
  destructive: false,
  preferredModel: 'sonnet',
  presentation: { statusLabel: 'Pinning the offered service' },
  execute: async (input, ctx) => {
    const draft = await getOrCreateDraftOffer(db, {
      organizationId: ctx.organizationId,
      conversationId: ctx.conversationId,
      serviceId: input.serviceId,
    });
    if (!draft.success) return { data: { error: draft.error.message } };

    if (
      draft.data.serviceIds.length === 1 &&
      draft.data.serviceIds[0] === input.serviceId
    ) {
      return {
        data: offerToSnapshot(
          draft.data.offer,
          draft.data.serviceIds,
          draft.data.locationIds
        ),
      };
    }

    const updated = await updateDraftOffer(db, {
      organizationId: ctx.organizationId,
      draftId: draft.data.offer.id,
      update: { serviceIds: [input.serviceId] },
      cascadeDefaults: true,
    });
    if (!updated.success) return { data: { error: updated.error.message } };

    // Same funnel hook as set_pending_ad_service: record the accept on the
    // cycle so promote/save events can attribute the published offer back
    // to the recommendation.
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
          kind: 'ad_flow_offer_pick',
          acceptedAtRank: ranked.rank,
        });
        trackRecommendationAccepted(ctx.organizationId, {
          surface: 'chat',
          kind: 'ad_flow_offer_pick',
          rankedServiceId: ranked.serviceId,
          rank: ranked.rank,
          acceptedAtRank: ranked.rank,
          marketPosition: profile.data.marketPosition,
          offerStrategy: ranked.offerStrategy,
        });
      }
    }

    return {
      data: offerToSnapshot(
        updated.data.offer,
        updated.data.serviceIds,
        updated.data.locationIds
      ),
    };
  },
});
