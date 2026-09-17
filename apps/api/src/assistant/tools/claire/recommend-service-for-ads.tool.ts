import { db } from '@borradh-workspace/database';
import {
  classifyBusiness,
  computeRecommendation,
  getBusinessProfile,
  hasPushedTopPick,
  markTopPickPushed,
  trackRecommendationImpression,
} from '@borradh-workspace/features/claire';
import { listServicesForOrg } from '@borradh-workspace/features/organization-services';
import { ErrorCodes } from '@borradh-workspace/features/shared';
import { logError } from '@borradh-workspace/observability';
import { z } from 'zod';
import { defineTool } from '../../tool-factory/index.js';
import type { ServiceRecommendationOutput } from './types.js';

/**
 * `claire_recommendService` — non-destructive. Returns the top-ranked
 * service for this org with offer-strategy reasoning.
 *
 * Push memory: on the first call within a (conversation, kind=ad_flow_service_pick)
 * cycle, this opens an active `assistantRecommendation` row. Subsequent
 * calls within the same cycle return the SAME pick with `alreadyPushed:
 * true`, signalling Claire to defer to the user instead of re-pushing.
 */
export const recommendServiceForAdsTool = defineTool<
  Record<string, never>,
  ServiceRecommendationOutput | { error: string }
>({
  feature: 'claire',
  action: 'recommendServiceForAds',
  description:
    'Returns the ONE service to advertise for this organization, with reasoning. Call this whenever the user shows any intent to create or discuss an ad, campaign, marketing activity, or promotion — even if phrased indirectly ("how do I get more clients", "I want to grow"). The engine returns a single pick — present that pick and only that pick, do NOT volunteer alternatives or second choices. If the user explicitly rejects the pick, then (and only then) call getAlternativeRecommendation. Do NOT call if the user has already chosen a specific service in this conversation. Push the pick at most ONCE per ad-creation cycle; the tool itself records this for you.',
  inputSchema: z.object({}),
  destructive: false,
  preferredModel: 'sonnet',
  presentation: { statusLabel: 'Picking the right service to advertise' },
  execute: async (_input, ctx) => {
    // Ensure the profile is current before recommending. `classifyBusiness` is
    // idempotent — when the stored profile's input hash AND classifier version
    // both match, it returns the cached row with no LLM call. When the menu
    // changed OR the classifier logic was bumped (a new `version`), it
    // reclassifies here so a stale cache can't drive a wrong pick. This also
    // self-heals a missing profile synchronously (no "try again in a minute").
    let profile = await classifyBusiness(db, {
      organizationId: ctx.organizationId,
      reason: 'services_changed',
    });
    if (!profile.success) {
      // classifyBusiness failed (e.g. transient). Fall back to whatever profile
      // is already stored so a classify hiccup doesn't block the recommendation.
      const fallback = await getBusinessProfile(db, {
        organizationId: ctx.organizationId,
      });
      if (!fallback.success) {
        if (fallback.error.code === ErrorCodes.NOT_FOUND) {
          const organizationId = ctx.organizationId;
          logError(
            'claire.recommendServiceForAds.classifyFailed',
            new Error(profile.error.message),
            { feature: 'claire', extra: { organizationId } }
          );
        }
        return {
          data: {
            error:
              "I don't have a recommendation yet — Claire is still classifying this business. Try again in a minute.",
          },
        };
      }
      profile = fallback;
    }

    const servicesResult = await listServicesForOrg(db, {
      organizationId: ctx.organizationId,
    });
    if (!servicesResult.success) {
      return { data: { error: servicesResult.error.message } };
    }
    const services = servicesResult.data;

    const { topService } = computeRecommendation(profile.data, services);
    if (!topService) {
      return {
        data: {
          error:
            'No ranked services available. Ask the user to add services first.',
        },
      };
    }

    const service = services.find((s) => s.id === topService.serviceId);
    if (!service) {
      return {
        data: {
          error: 'Top-ranked service no longer exists in the menu.',
        },
      };
    }

    // Push-memory check + open cycle.
    const pushed = await hasPushedTopPick(db, {
      organizationId: ctx.organizationId,
      conversationId: ctx.conversationId,
      kind: 'ad_flow_service_pick',
    });
    const alreadyPushed = pushed.success ? pushed.data : false;
    if (!alreadyPushed) {
      await markTopPickPushed(db, {
        organizationId: ctx.organizationId,
        conversationId: ctx.conversationId,
        kind: 'ad_flow_service_pick',
        rankedServiceId: topService.serviceId,
      });
      // Only emit impression the FIRST time we surface the top pick in this
      // cycle. Subsequent recommend_* calls inside the same cycle hit the
      // `alreadyPushed` branch and are no-ops (per Decision #10 — push memory
      // keyed to the assistantRecommendation lifecycle).
      trackRecommendationImpression(ctx.organizationId, {
        surface: 'chat',
        kind: 'ad_flow_service_pick',
        rankedServiceId: topService.serviceId,
        rank: topService.rank,
        marketPosition: profile.data.marketPosition,
        offerStrategy: topService.offerStrategy,
      });
    }

    return {
      data: {
        serviceId: topService.serviceId,
        serviceName: service.name,
        rank: topService.rank,
        title: topService.serviceRecommendationCopy.title,
        body: topService.serviceRecommendationCopy.body,
        offer: {
          strategy: topService.offerStrategy,
          suggestedIntroPrice: topService.suggestedIntroPrice,
          title: topService.offerRecommendationCopy.title,
          body: topService.offerRecommendationCopy.body,
        },
        isTopPick: true,
        alreadyPushed,
      },
    };
  },
});
