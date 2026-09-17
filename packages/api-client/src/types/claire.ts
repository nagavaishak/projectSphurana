/**
 * @borradh-workspace/api-client - Claire API Types
 *
 * Types for the Claire-Owner widget (recommendation toast + walkthrough dispatcher)
 * and the Claire recommendation-engine surface (3-axis classifier + ranked services).
 * Backend keeps the `assistant_*` naming; "Claire" is a UI/brand name only
 * (see docs/plans/claire-spec-v2.md Decision 1).
 *
 * Types are derived from backend packages — features/shared re-exports the
 * canonical labels and types from database. api-client never imports from
 * @borradh-workspace/database directly.
 */

// Runtime values (labels + enum value arrays) — for UI dropdowns and select inputs.
import {
  assistantActionTypeLabels,
  assistantActionTypeValues,
  assistantRecommendationKindLabels,
  assistantRecommendationKindValues,
  assistantRecommendationStateLabels,
  assistantRecommendationStateValues,
  businessVerticalLabels,
  businessVerticalValues,
  commitmentLevelLabels,
  commitmentLevelValues,
  marketPositionLabels,
  marketPositionValues,
  offerStrategyLabels,
  offerStrategyValues,
  retentionModelLabels,
  retentionModelValues,
} from '@borradh-workspace/features/shared';

// Backend types (isolatedModules-compliant separate import)
import type {
  AssistantActionType,
  AssistantPrimaryAction,
  AssistantRecommendationKind,
  AssistantRecommendationState,
  AxisSnapshot,
  AssistantRecommendation as BackendAssistantRecommendation,
  BusinessProfile as BackendBusinessProfile,
  BusinessVertical,
  CommitmentLevel,
  Disagreement,
  MarketPosition,
  OfferStrategy,
  RankedService,
  RetentionModel,
} from '@borradh-workspace/features/shared';

import type { Serialize } from './serialization.js';

// ============================================================================
// ENUM TYPES — re-exported from features/shared (Labels pattern)
// ============================================================================

export type {
  AssistantActionType,
  AssistantPrimaryAction,
  AssistantRecommendationKind,
  AssistantRecommendationState,
  AxisSnapshot,
  BusinessVertical,
  CommitmentLevel,
  Disagreement,
  MarketPosition,
  OfferStrategy,
  RankedService,
  RetentionModel,
};

// Re-export labels and values for frontend use (dropdowns, badges, copy lookups)
export {
  assistantActionTypeLabels,
  assistantActionTypeValues,
  assistantRecommendationKindLabels,
  assistantRecommendationKindValues,
  assistantRecommendationStateLabels,
  assistantRecommendationStateValues,
  businessVerticalLabels,
  businessVerticalValues,
  commitmentLevelLabels,
  commitmentLevelValues,
  marketPositionLabels,
  marketPositionValues,
  offerStrategyLabels,
  offerStrategyValues,
  retentionModelLabels,
  retentionModelValues,
};

// ============================================================================
// ENTITY TYPES — Serialized for API responses (Date → string)
// ============================================================================

/**
 * Recommendation row as returned by the API.
 * Date fields are serialized to ISO strings over the wire.
 */
export type AssistantRecommendation = Serialize<BackendAssistantRecommendation>;

/**
 * Business profile row as returned by the API.
 * Date fields are serialized to ISO strings over the wire.
 */
export type BusinessProfile = Serialize<BackendBusinessProfile>;

// ============================================================================
// AD-CREATION-CONTEXT — payload shape served by GET /claire/ad-creation-context
// ============================================================================

export type AdCreationContextProfileState = 'fresh' | 'pending' | 'missing';

export interface AdCreationContextService {
  serviceId: string;
  title: string;
  body: string;
  reasoning: string;
  objections: RankedService['objections'];
}

export interface AdCreationContextOffer {
  strategy: OfferStrategy;
  suggestedIntroPrice?: number;
  title: string;
  body: string;
  reasoning: string;
}

export interface AdCreationContextAlternative {
  serviceId: string;
  rank: number;
  title: string;
}

export interface AdCreationContextResponse {
  service: AdCreationContextService | null;
  offer: AdCreationContextOffer | null;
  alternatives: AdCreationContextAlternative[];
  profileState: AdCreationContextProfileState;
  needsMarketPosition: boolean;
  disagreement: Disagreement | null;
}

// ============================================================================
// MUTATION INPUTS
// ============================================================================

export interface OverrideAxesInput {
  axes: {
    retentionModel?: RetentionModel;
    commitmentLevel?: CommitmentLevel;
    marketPosition?: MarketPosition;
  };
}

export interface ResolveDisagreementInput {
  resolution: 'owner_held' | 'owner_changed';
}

export interface SetMarketPositionInput {
  marketPosition: MarketPosition;
}
