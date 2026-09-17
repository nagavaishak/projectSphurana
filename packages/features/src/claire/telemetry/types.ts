/**
 * Telemetry types for the Claire recommendation engine funnel.
 *
 * Properties intentionally exclude PII — never include email, name, phone,
 * or free-text caption/headline content. IDs and enums only.
 *
 * Event-name convention is `claire.<subject>.<action>` to match the existing
 * `experiment.assigned` namespaced PostHog events in this codebase.
 */

import type { OfferStrategy } from '@borradh-workspace/labels';
import type { ClaireCycleKind } from '../push-memory/index.js';

export type Surface = 'ads_new' | 'chat';

export type RecommendationKind = ClaireCycleKind;

export interface BaseRecommendationEventProperties {
  surface: Surface;
  kind: RecommendationKind;
  rankedServiceId: string;
  rank: number;
  marketPosition?: 'below' | 'at' | 'above' | 'unknown';
  offerStrategy?: OfferStrategy;
}

export interface ImpressionProperties
  extends BaseRecommendationEventProperties {}

export interface AcceptedProperties extends BaseRecommendationEventProperties {
  acceptedAtRank: number;
}

export type DismissReason = 'show_alternative' | 'skipped' | 'override';

export interface DismissedProperties extends BaseRecommendationEventProperties {
  dismissReason: DismissReason;
}

export interface EditedProperties extends AcceptedProperties {
  editedFields: string[];
}

export interface PublishedProperties extends AcceptedProperties {
  publishedAdId?: string;
  publishedOfferId?: string;
  secondsFromImpression: number;
}

export interface DraftSavedProperties extends AcceptedProperties {
  draftId: string;
}

export type AbandonState = 'never_accepted' | 'accepted_not_published';

export interface AbandonedProperties extends BaseRecommendationEventProperties {
  state: AbandonState;
}

export interface DisagreementBaseProperties {
  surface: Surface;
  axes: string[];
  classifierConfidence: number;
  ownerOverride?: Record<string, string | undefined>;
  classifierProposal?: Record<string, string | undefined>;
}

export interface DisagreementSurfacedProperties
  extends DisagreementBaseProperties {}

export interface DisagreementResolvedProperties
  extends DisagreementBaseProperties {
  resolution: 'owner_held' | 'owner_changed' | 'ignored' | 'dismissed';
}

export interface DisagreementIgnoredAutoProperties
  extends DisagreementBaseProperties {
  daysSinceSurfaced: number;
}

export type ClassifierRunReason =
  | 'onboarding'
  | 'services_changed'
  | 'override'
  | 'backfill'
  | 'force'
  | 'unknown';

export interface ClassifierRunProperties {
  organizationId: string;
  vertical: string;
  classifierVersion: string;
  reason: ClassifierRunReason;
  durationMs: number;
  tookLlmFallback: boolean;
}

export interface ClassifierFailedProperties extends ClassifierRunProperties {
  errorCode: string;
  errorMessage: string;
}

export interface ClassifierDisagreementDetectedProperties {
  organizationId: string;
  vertical: string;
  classifierVersion: string;
  axes: string[];
  classifierConfidence: number;
}
