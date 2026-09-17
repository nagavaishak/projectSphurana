import { logError, trackOrgEvent } from '@borradh-workspace/observability';
import type {
  AbandonedProperties,
  AcceptedProperties,
  ClassifierDisagreementDetectedProperties,
  ClassifierFailedProperties,
  ClassifierRunProperties,
  DisagreementBaseProperties,
  DisagreementIgnoredAutoProperties,
  DisagreementResolvedProperties,
  DisagreementSurfacedProperties,
  DismissedProperties,
  DraftSavedProperties,
  EditedProperties,
  ImpressionProperties,
  PublishedProperties,
} from './types.js';

/**
 * PostHog node accepts flat `string | number | boolean | null | undefined`
 * values only. Convert arrays + nested objects to scalar fields here so the
 * call site stays typed and ergonomic.
 */
type FlatProperties = Record<
  string,
  string | number | boolean | null | undefined
>;

const safeTrack = (
  organizationId: string,
  event: string,
  properties: FlatProperties
): void => {
  try {
    // Claire telemetry is org-level (no acting app user): attribute to the
    // organization group and keep it anonymous at the person level.
    trackOrgEvent(organizationId, event, properties);
  } catch (error) {
    logError('claire.telemetry', error, {
      feature: 'claire',
      extra: { event, organizationId },
    });
  }
};

const flattenDisagreementBase = (
  props: DisagreementBaseProperties
): FlatProperties => ({
  surface: props.surface,
  // PostHog dashboards filter cleanly on a comma-joined axis list.
  axes: props.axes.slice().sort().join(','),
  axisCount: props.axes.length,
  classifierConfidence: props.classifierConfidence,
  ownerOverrideRetentionModel: props.ownerOverride?.retentionModel,
  ownerOverrideCommitmentLevel: props.ownerOverride?.commitmentLevel,
  ownerOverrideMarketPosition: props.ownerOverride?.marketPosition,
  classifierProposalRetentionModel: props.classifierProposal?.retentionModel,
  classifierProposalCommitmentLevel: props.classifierProposal?.commitmentLevel,
  classifierProposalMarketPosition: props.classifierProposal?.marketPosition,
});

export const trackRecommendationImpression = (
  organizationId: string,
  properties: ImpressionProperties
): void => {
  safeTrack(organizationId, 'claire.recommendation.impression', {
    surface: properties.surface,
    kind: properties.kind,
    rankedServiceId: properties.rankedServiceId,
    rank: properties.rank,
    marketPosition: properties.marketPosition,
    offerStrategy: properties.offerStrategy,
  });
};

export const trackRecommendationAccepted = (
  organizationId: string,
  properties: AcceptedProperties
): void => {
  safeTrack(organizationId, 'claire.recommendation.accepted', {
    surface: properties.surface,
    kind: properties.kind,
    rankedServiceId: properties.rankedServiceId,
    rank: properties.rank,
    acceptedAtRank: properties.acceptedAtRank,
    marketPosition: properties.marketPosition,
    offerStrategy: properties.offerStrategy,
  });
};

export const trackRecommendationDismissed = (
  organizationId: string,
  properties: DismissedProperties
): void => {
  safeTrack(organizationId, 'claire.recommendation.dismissed', {
    surface: properties.surface,
    kind: properties.kind,
    rankedServiceId: properties.rankedServiceId,
    rank: properties.rank,
    marketPosition: properties.marketPosition,
    offerStrategy: properties.offerStrategy,
    dismissReason: properties.dismissReason,
  });
};

export const trackRecommendationEdited = (
  organizationId: string,
  properties: EditedProperties
): void => {
  safeTrack(organizationId, 'claire.recommendation.edited', {
    surface: properties.surface,
    kind: properties.kind,
    rankedServiceId: properties.rankedServiceId,
    rank: properties.rank,
    acceptedAtRank: properties.acceptedAtRank,
    marketPosition: properties.marketPosition,
    offerStrategy: properties.offerStrategy,
    editedFields: properties.editedFields.slice().sort().join(','),
    editedFieldCount: properties.editedFields.length,
  });
};

export const trackRecommendationPublished = (
  organizationId: string,
  properties: PublishedProperties
): void => {
  safeTrack(organizationId, 'claire.recommendation.published', {
    surface: properties.surface,
    kind: properties.kind,
    rankedServiceId: properties.rankedServiceId,
    rank: properties.rank,
    acceptedAtRank: properties.acceptedAtRank,
    marketPosition: properties.marketPosition,
    offerStrategy: properties.offerStrategy,
    publishedAdId: properties.publishedAdId,
    publishedOfferId: properties.publishedOfferId,
    secondsFromImpression: properties.secondsFromImpression,
  });
};

export const trackRecommendationDraftSaved = (
  organizationId: string,
  properties: DraftSavedProperties
): void => {
  safeTrack(organizationId, 'claire.recommendation.draft_saved', {
    surface: properties.surface,
    kind: properties.kind,
    rankedServiceId: properties.rankedServiceId,
    rank: properties.rank,
    acceptedAtRank: properties.acceptedAtRank,
    marketPosition: properties.marketPosition,
    offerStrategy: properties.offerStrategy,
    draftId: properties.draftId,
  });
};

export const trackRecommendationAbandoned = (
  organizationId: string,
  properties: AbandonedProperties
): void => {
  safeTrack(organizationId, 'claire.recommendation.abandoned', {
    surface: properties.surface,
    kind: properties.kind,
    rankedServiceId: properties.rankedServiceId,
    rank: properties.rank,
    marketPosition: properties.marketPosition,
    offerStrategy: properties.offerStrategy,
    state: properties.state,
  });
};

export const trackDisagreementSurfaced = (
  organizationId: string,
  properties: DisagreementSurfacedProperties
): void => {
  safeTrack(
    organizationId,
    'claire.disagreement.surfaced',
    flattenDisagreementBase(properties)
  );
};

export const trackDisagreementResolved = (
  organizationId: string,
  properties: DisagreementResolvedProperties
): void => {
  safeTrack(organizationId, 'claire.disagreement.resolved', {
    ...flattenDisagreementBase(properties),
    resolution: properties.resolution,
  });
};

export const trackDisagreementIgnoredAuto = (
  organizationId: string,
  properties: DisagreementIgnoredAutoProperties
): void => {
  safeTrack(organizationId, 'claire.disagreement.ignored_auto', {
    ...flattenDisagreementBase(properties),
    daysSinceSurfaced: properties.daysSinceSurfaced,
  });
};

export const trackClassifierRun = (
  properties: ClassifierRunProperties
): void => {
  safeTrack(properties.organizationId, 'claire.classifier.run', {
    organizationId: properties.organizationId,
    vertical: properties.vertical,
    classifierVersion: properties.classifierVersion,
    reason: properties.reason,
    durationMs: properties.durationMs,
    tookLlmFallback: properties.tookLlmFallback,
  });
};

export const trackClassifierFailed = (
  properties: ClassifierFailedProperties
): void => {
  safeTrack(properties.organizationId, 'claire.classifier.failed', {
    organizationId: properties.organizationId,
    vertical: properties.vertical,
    classifierVersion: properties.classifierVersion,
    reason: properties.reason,
    durationMs: properties.durationMs,
    tookLlmFallback: properties.tookLlmFallback,
    errorCode: properties.errorCode,
    errorMessage: properties.errorMessage,
  });
};

export const trackClassifierDisagreementDetected = (
  properties: ClassifierDisagreementDetectedProperties
): void => {
  safeTrack(
    properties.organizationId,
    'claire.classifier.disagreement_detected',
    {
      organizationId: properties.organizationId,
      vertical: properties.vertical,
      classifierVersion: properties.classifierVersion,
      axes: properties.axes.slice().sort().join(','),
      axisCount: properties.axes.length,
      classifierConfidence: properties.classifierConfidence,
    }
  );
};
