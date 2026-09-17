import { createId } from '@paralleldrive/cuid2';
import { relations } from 'drizzle-orm';
import {
  index,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
} from 'drizzle-orm/pg-core';
import { orgRlsPolicy } from '../rls-policy.js';
import { organization } from './organization.js';

import {
  experimentStatusLabels,
  experimentStatusValues,
} from '@borradh-workspace/labels';

// Re-export labels and types for consumers
export { experimentStatusLabels, experimentStatusValues };
export type { ExperimentStatus } from '@borradh-workspace/labels';

// ==================== ENUMS ====================

export const experimentStatusEnum = pgEnum(
  'experiment_status',
  experimentStatusValues
);

// ==================== TYPE INTERFACES ====================

/**
 * Variant configuration for an experiment.
 * Keys are variant identifiers (e.g., 'control', 'treatment'),
 * values describe the variant.
 */
export interface ExperimentVariantConfig {
  [variant: string]: {
    label: string;
    weight: number;
  };
}

// ==================== EXPERIMENT TABLE ====================

/**
 * Experiment definition — describes an A/B test or feature flag experiment.
 */
export const experiment = pgTable('experiment', {
  id: text('id')
    .primaryKey()
    .$defaultFn(() => createId()),

  // Unique key used in code to reference this experiment
  key: text('key').notNull().unique(),

  // Human-readable name
  name: text('name').notNull(),

  // Optional description
  description: text('description'),

  // Variant definitions with weights
  variants: jsonb('variants').$type<ExperimentVariantConfig>().notNull(),

  // Status
  status: experimentStatusEnum('status').notNull().default('active'),

  // Optional PostHog feature flag key for server-side assignment
  posthogFeatureKey: text('posthog_feature_key'),

  // Timestamps
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at')
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

// ==================== EXPERIMENT ASSIGNMENT TABLE ====================

/**
 * Records which variant an organization was assigned to for a given experiment.
 * One assignment per org per experiment — immutable once created.
 */
export const experimentAssignment = pgTable(
  'experiment_assignment',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => createId()),

    // Which experiment
    experimentId: text('experiment_id')
      .notNull()
      .references(() => experiment.id, { onDelete: 'cascade' }),

    // Which organization
    organizationId: text('organization_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),

    // Assigned variant (e.g., 'control' or 'treatment')
    variant: text('variant').notNull(),

    // When the assignment was made
    assignedAt: timestamp('assigned_at').notNull().defaultNow(),
  },
  (table) => [
    unique('experiment_assignment_unique').on(
      table.experimentId,
      table.organizationId
    ),
    index('idx_experiment_assignment_org_id').on(table.organizationId),
    index('idx_experiment_assignment_experiment_id').on(table.experimentId),
  ]
);

// ==================== RLS POLICIES ====================

// `experiment` is Bucket B global (no organization_id) — W-GLOBAL handles it.
// `experiment_assignment` is Bucket A — standard org-isolation policy.
export const experimentAssignmentRlsPolicy = orgRlsPolicy(experimentAssignment);

// ==================== RELATIONS ====================

export const experimentRelations = relations(experiment, ({ many }) => ({
  assignments: many(experimentAssignment),
}));

export const experimentAssignmentRelations = relations(
  experimentAssignment,
  ({ one }) => ({
    experiment: one(experiment, {
      fields: [experimentAssignment.experimentId],
      references: [experiment.id],
    }),
    organization: one(organization, {
      fields: [experimentAssignment.organizationId],
      references: [organization.id],
    }),
  })
);

// ==================== TYPE EXPORTS ====================

export type Experiment = typeof experiment.$inferSelect;
export type NewExperiment = typeof experiment.$inferInsert;
export type ExperimentAssignment = typeof experimentAssignment.$inferSelect;
export type NewExperimentAssignment = typeof experimentAssignment.$inferInsert;
