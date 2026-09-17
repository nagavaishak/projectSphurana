import type {
  BusinessProfile,
  OrganizationService,
  RankedService,
} from '@borradh-workspace/database';
import { getVerticalConfig } from '../verticals/registry.js';
import type { Axes } from '../verticals/types.js';
import {
  renderObjections,
  resolveStrategies,
} from './compose-recommendation.js';

// ============================================================================
// Live ranking (the architecture refactor)
// ============================================================================
//
// Splits the cached `business_profile.rankedServices` into two kinds of data:
//
//   • Decision data (rank, score, criteriaScores, offerStrategy,
//     suggestedIntroPrice, offerStrategyReason, objections) — recomputed LIVE,
//     pure/sync, with NO LLM call. A change to the ranking code or a change to
//     the org's services/prices takes effect immediately, without waiting for
//     a (gated, expensive) re-classification.
//
//   • Copy (serviceRecommendationCopy, offerRecommendationCopy) — LLM-rendered
//     and therefore CACHED. We reuse the copy stored on the profile, matched by
//     serviceId; a service with no cached copy gets the deterministic, sync
//     static fallback from the vertical config. The read path never calls an LLM.
//
// `classifyBusiness` still writes `rankedServices` exactly as before; that row
// now serves purely as the copy cache + classification snapshot.

const axesFromProfile = (profile: BusinessProfile): Axes => ({
  retentionModel: profile.retentionModel,
  commitmentLevel: profile.commitmentLevel,
  marketPosition: profile.marketPosition,
});

/**
 * Return the cached LLM ranking, filtered to services still in the menu and
 * re-ranked 1..N. A service that's been deleted drops out; a service added
 * since the last classify (rare — a menu change triggers reclassify) is
 * appended at the end so it's never lost. No keyword scoring, no LLM call.
 */
const honourCachedRanking = (
  profile: BusinessProfile,
  services: OrganizationService[]
): RankedService[] => {
  const present = new Set(services.map((s) => s.id));
  const cached = (profile.rankedServices ?? []).filter((r) =>
    present.has(r.serviceId)
  );
  const rankedIds = new Set(cached.map((r) => r.serviceId));

  const composed: RankedService[] = cached.map((r, i) => ({
    ...r,
    rank: i + 1,
  }));

  // Defensive: surface any menu service missing from the cache at the end as a
  // neutral entry so it's selectable, rather than vanishing.
  let nextRank = composed.length;
  for (const service of services) {
    if (rankedIds.has(service.id)) continue;
    nextRank += 1;
    composed.push({
      serviceId: service.id,
      rank: nextRank,
      score: 0,
      criteriaScores: {
        retentionFit: 0,
        barrierToEntry: 0,
        crossSell: 0,
        complianceRisk: 0,
      },
      marketPosition: profile.marketPosition,
      offerStrategy: 'price_hidden_conversation',
      offerStrategyReason:
        'Added since the last classification — pending re-rank.',
      serviceRecommendationCopy: { title: service.name, body: '' },
      offerRecommendationCopy: { title: service.name, body: '' },
      objections: [],
    });
  }

  return composed;
};

/**
 * Recompute the full ranked-service list LIVE from the CURRENT services + the
 * profile's axes. Pure, sync, no LLM. Decision data is always fresh; copy is
 * reused from the profile cache when present, else the deterministic static
 * fallback.
 *
 * Returns `RankedService[]` in the same shape as the old cached value, so every
 * caller is unchanged. Order is by rank ascending.
 */
export const recomputeRanking = (
  profile: BusinessProfile,
  services: OrganizationService[]
): RankedService[] => {
  if (services.length === 0) return [];

  // LLM-picked rankings are a holistic decision, not a keyword score — the read
  // path must HONOUR the cached order/strategy/intro/copy rather than
  // recomputing it live (which would re-impose the keyword ranker). A menu or
  // price change invalidates the input hash → reclassify → the LLM re-picks, so
  // the cache stays current. We still recompute live for the keyword path
  // (`rankingSource !== 'llm'`) so its decision data reflects edits immediately.
  const rankingSource = (profile.verticalMetadata as { rankingSource?: string })
    ?.rankingSource;
  if (rankingSource === 'llm') {
    return honourCachedRanking(profile, services);
  }

  const axes = axesFromProfile(profile);
  const config = getVerticalConfig(profile.vertical);

  const rankedBase = config.rankServices({
    axes,
    services,
    verticalMetadata: profile.verticalMetadata,
  });
  if (rankedBase.length === 0) return [];

  const servicesById = new Map(services.map((s) => [s.id, s]));
  const cachedCopyById = new Map(
    (profile.rankedServices ?? []).map((r) => [r.serviceId, r])
  );

  const finalStrategies = resolveStrategies(rankedBase, services, axes, config);

  const composed: RankedService[] = [];
  for (let i = 0; i < rankedBase.length; i++) {
    const ranked = rankedBase[i];
    const offerStrategy = finalStrategies[i];
    if (!ranked || !offerStrategy) continue;
    const service = servicesById.get(ranked.serviceId);

    // Mirrors composeRecommendation's "service vanished mid-compose" guard. In
    // practice rankServices only ranks services that exist, so this is defensive.
    if (!service) {
      composed.push({
        ...ranked,
        offerStrategy: 'switch_service',
        offerStrategyReason:
          'Service no longer exists in menu. Switch to the next ranked service.',
        serviceRecommendationCopy: {
          title: 'Service unavailable',
          body: 'This service is no longer in the menu.',
        },
        offerRecommendationCopy: {
          title: 'Service unavailable',
          body: 'This service is no longer in the menu.',
        },
        objections: [],
      });
      continue;
    }

    // Copy: reuse the cached LLM copy for this service when present; otherwise
    // fall back to the deterministic static copy (sync, no LLM).
    const cached = cachedCopyById.get(ranked.serviceId);
    const serviceCopy =
      cached?.serviceRecommendationCopy ??
      config.staticServiceCopy({
        organizationName: '',
        axes,
        ranked,
        service,
        chatbotSettings: null,
      });
    const offerCopy =
      cached?.offerRecommendationCopy ??
      config.staticOfferCopy({
        organizationName: '',
        axes,
        ranked,
        service,
        offerStrategy,
        chatbotSettings: null,
      });

    composed.push({
      ...ranked,
      offerStrategy: offerStrategy.strategy,
      suggestedIntroPrice: offerStrategy.suggestedIntroPrice,
      offerStrategyReason: offerStrategy.reason,
      serviceRecommendationCopy: serviceCopy,
      offerRecommendationCopy: offerCopy,
      objections: renderObjections(config, offerStrategy.strategy),
    });
  }

  return composed;
};
