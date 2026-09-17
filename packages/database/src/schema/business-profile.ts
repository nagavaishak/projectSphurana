import { createId } from '@paralleldrive/cuid2';
import { relations } from 'drizzle-orm';
import {
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  text,
  timestamp,
} from 'drizzle-orm/pg-core';
import { orgRlsPolicy } from '../rls-policy.js';
import { organization } from './organization.js';

// Labels live in @borradh-workspace/labels (leaf package, no drizzle deps).
import {
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
} from '@borradh-workspace/labels';

// Re-export labels + values + types for consumers
export {
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
export type {
  BusinessVertical,
  CommitmentLevel,
  MarketPosition,
  OfferStrategy,
  RetentionModel,
} from '@borradh-workspace/labels';

import type {
  CommitmentLevel,
  MarketPosition,
  OfferStrategy,
  RetentionModel,
} from '@borradh-workspace/labels';

// ============================================================================
// ENUMS
// ============================================================================

export const businessVerticalEnum = pgEnum(
  'business_vertical',
  businessVerticalValues
);

export const retentionModelEnum = pgEnum(
  'retention_model',
  retentionModelValues
);

export const commitmentLevelEnum = pgEnum(
  'commitment_level',
  commitmentLevelValues
);

export const marketPositionEnum = pgEnum(
  'market_position',
  marketPositionValues
);

export const offerStrategyEnum = pgEnum('offer_strategy', offerStrategyValues);

// ============================================================================
// JSONB SHAPES
// ============================================================================

export type RankedService = {
  serviceId: string;
  rank: number;
  score: number;
  criteriaScores: {
    retentionFit: number;
    barrierToEntry: number;
    crossSell: number;
    complianceRisk: number;
  };
  marketPosition: MarketPosition;
  ownerEstimatedCompetitorPrice?: number;
  offerStrategy: OfferStrategy;
  suggestedIntroPrice?: number;
  offerStrategyReason: string;
  serviceRecommendationCopy: { title: string; body: string };
  offerRecommendationCopy: { title: string; body: string };
  objections: Array<{ id: string; trigger: string; response: string }>;
};

export type AxisSnapshot = {
  retentionModel: RetentionModel;
  commitmentLevel: CommitmentLevel;
  marketPosition: MarketPosition;
};

export type ClassifierAxes = AxisSnapshot & {
  confidence: number;
  reasoning: string;
};

export type OverriddenAxes = {
  retentionModel?: RetentionModel;
  commitmentLevel?: CommitmentLevel;
  marketPosition?: MarketPosition;
  overriddenAt: string; // ISO timestamp
  overriddenBy: string; // userId
};

export type Disagreement = {
  axes: Array<'retentionModel' | 'commitmentLevel' | 'marketPosition'>;
  classifierConfidence: number;
  surfaced: boolean;
  surfacedAt: string | null;
  resolution: 'pending' | 'owner_held' | 'owner_changed' | 'ignored';
};

// ============================================================================
// TABLE — 1:1 with organization
// ============================================================================

export const businessProfile = pgTable('business_profile', {
  id: text('id')
    .primaryKey()
    .$defaultFn(() => createId()),
  organizationId: text('organization_id')
    .notNull()
    .unique()
    .references(() => organization.id, { onDelete: 'cascade' }),

  vertical: businessVerticalEnum('vertical').notNull(),
  retentionModel: retentionModelEnum('retention_model').notNull(),
  commitmentLevel: commitmentLevelEnum('commitment_level').notNull(),
  marketPosition: marketPositionEnum('market_position')
    .notNull()
    .default('unknown'),

  axesConfidence: numeric('axes_confidence').$type<number>(),
  axesReasoning: text('axes_reasoning'),

  classifierAxes: jsonb('classifier_axes').$type<ClassifierAxes | null>(),
  overriddenAxes: jsonb('overridden_axes').$type<OverriddenAxes | null>(),
  disagreement: jsonb('disagreement').$type<Disagreement | null>(),

  rankedServices: jsonb('ranked_services')
    .$type<RankedService[]>()
    .notNull()
    .default([]),

  inputHash: text('input_hash').notNull(),
  classifiedAt: timestamp('classified_at').defaultNow().notNull(),
  classifierVersion: text('classifier_version').notNull(),

  verticalMetadata: jsonb('vertical_metadata')
    .$type<Record<string, unknown>>()
    .notNull()
    .default({}),

  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at')
    .defaultNow()
    .$onUpdate(() => new Date())
    .notNull(),
});

export const businessProfileRelations = relations(
  businessProfile,
  ({ one }) => ({
    organization: one(organization, {
      fields: [businessProfile.organizationId],
      references: [organization.id],
    }),
  })
);

export const businessProfileRlsPolicy = orgRlsPolicy(businessProfile);

export type BusinessProfile = typeof businessProfile.$inferSelect;
export type NewBusinessProfile = typeof businessProfile.$inferInsert;
