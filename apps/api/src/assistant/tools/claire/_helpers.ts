import { type MetaAd, type Offer, db } from '@borradh-workspace/database';
import {
  type ClaireCycleKind,
  type ClaireCycleMetadata,
  getBusinessProfile,
  getCurrentCycle,
  recomputeRanking,
  trackRecommendationDraftSaved,
  trackRecommendationPublished,
} from '@borradh-workspace/features/claire';
import { listServicesForOrg } from '@borradh-workspace/features/organization-services';
import type { DraftAdSnapshot, DraftOfferSnapshot } from './types.js';

export const adToSnapshot = (
  ad: MetaAd,
  serviceIds: string[]
): DraftAdSnapshot => ({
  draftId: ad.id,
  name: ad.name,
  headline: ad.headline,
  primaryText: ad.primaryText,
  description: ad.description,
  callToAction: ad.callToAction,
  destinationUrl: ad.destinationUrl,
  serviceIds,
  followUpType: ad.followUpType,
  adPlacement: ad.adPlacement,
  metaCampaignId: ad.metaCampaignId,
  metaAdsPageId: ad.metaAdsPageId,
  videoId: ad.videoId,
  targeting: ad.targetingOverride,
  status: ad.status,
});

/**
 * Telemetry helper: read the push-memory cycle for this conversation and,
 * if the operator previously accepted a recommended service, emit the
 * matching `published` event. Non-blocking — failures are swallowed so a
 * launched ad never gets rolled back by a telemetry bug. Returns silently
 * when there's no active cycle or no accepted rank on the cycle (e.g. the
 * operator picked a service NOT in the ranked list).
 */
export const emitCyclePublishedEvent = async (params: {
  organizationId: string;
  conversationId: string;
  kind: ClaireCycleKind;
  publishedAdId?: string;
  publishedOfferId?: string;
}): Promise<void> => {
  const { organizationId, conversationId, kind } = params;
  const cycle = await getCurrentCycle(db, {
    organizationId,
    conversationId,
    kind,
  });
  if (!cycle.success || !cycle.data) return;
  const metadata = (cycle.data.metadata as ClaireCycleMetadata | null) ?? null;
  if (!metadata?.acceptedAtRank || !metadata.rankedServiceId) return;

  const profile = await getBusinessProfile(db, { organizationId });
  const services = await listServicesForOrg(db, { organizationId });
  const ranked =
    profile.success && services.success
      ? recomputeRanking(profile.data, services.data).find(
          (r) => r.serviceId === metadata.rankedServiceId
        )
      : undefined;

  const impressionAt = metadata.impressionAt
    ? new Date(metadata.impressionAt).getTime()
    : null;
  const secondsFromImpression = impressionAt
    ? Math.max(0, (Date.now() - impressionAt) / 1000)
    : 0;

  trackRecommendationPublished(organizationId, {
    surface: 'chat',
    kind,
    rankedServiceId: metadata.rankedServiceId,
    rank: ranked?.rank ?? metadata.acceptedAtRank,
    acceptedAtRank: metadata.acceptedAtRank,
    marketPosition: profile.success ? profile.data.marketPosition : undefined,
    offerStrategy: ranked?.offerStrategy,
    publishedAdId: params.publishedAdId,
    publishedOfferId: params.publishedOfferId,
    secondsFromImpression,
  });
};

/**
 * Mirror of `emitCyclePublishedEvent` for the Save Draft path. Emits a
 * `draft_saved` event keyed off the same cycle metadata.
 */
export const emitCycleDraftSavedEvent = async (params: {
  organizationId: string;
  conversationId: string;
  kind: ClaireCycleKind;
  draftId: string;
}): Promise<void> => {
  const { organizationId, conversationId, kind, draftId } = params;
  const cycle = await getCurrentCycle(db, {
    organizationId,
    conversationId,
    kind,
  });
  if (!cycle.success || !cycle.data) return;
  const metadata = (cycle.data.metadata as ClaireCycleMetadata | null) ?? null;
  if (!metadata?.acceptedAtRank || !metadata.rankedServiceId) return;

  const profile = await getBusinessProfile(db, { organizationId });
  const services = await listServicesForOrg(db, { organizationId });
  const ranked =
    profile.success && services.success
      ? recomputeRanking(profile.data, services.data).find(
          (r) => r.serviceId === metadata.rankedServiceId
        )
      : undefined;

  trackRecommendationDraftSaved(organizationId, {
    surface: 'chat',
    kind,
    rankedServiceId: metadata.rankedServiceId,
    rank: ranked?.rank ?? metadata.acceptedAtRank,
    acceptedAtRank: metadata.acceptedAtRank,
    marketPosition: profile.success ? profile.data.marketPosition : undefined,
    offerStrategy: ranked?.offerStrategy,
    draftId,
  });
};

export const offerToSnapshot = (
  offer: Offer,
  serviceIds: string[],
  locationIds: string[]
): DraftOfferSnapshot => ({
  draftId: offer.id,
  name: offer.name,
  code: offer.code,
  state: offer.state,
  discountType: offer.discountType,
  discountPercent: offer.discountPercent,
  offerPriceCents: offer.offerPriceCents,
  originalPriceCents: offer.originalPriceCents,
  buyQuantity: offer.buyQuantity,
  getQuantity: offer.getQuantity,
  limitPerClient: offer.limitPerClient,
  redemptionLimit: offer.redemptionLimit,
  validFrom: offer.validFrom ? offer.validFrom.toISOString() : null,
  validUntil: offer.validUntil ? offer.validUntil.toISOString() : null,
  serviceIds,
  locationIds,
});
