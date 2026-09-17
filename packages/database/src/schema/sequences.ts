import { createId } from '@paralleldrive/cuid2';
import {
  boolean,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
} from 'drizzle-orm/pg-core';
import { childOrgRlsPolicy, orgRlsPolicy } from '../rls-policy.js';
import { lead } from './leads.js';
import { organization } from './organization.js';
import { user } from './user.js';

// Import labels from enums (pure TypeScript)
import {
  sequenceExecutionStatusLabels,
  sequenceExecutionStatusValues,
  sequenceStepTypeLabels,
  sequenceStepTypeValues,
  sequenceVersionChangeTypeLabels,
  sequenceVersionChangeTypeValues,
} from '@borradh-workspace/labels';

// Re-export labels and types for consumers
export {
  sequenceStepTypeLabels,
  sequenceStepTypeValues,
  sequenceVersionChangeTypeLabels,
  sequenceVersionChangeTypeValues,
  sequenceExecutionStatusLabels,
  sequenceExecutionStatusValues,
};
export type {
  SequenceStepType,
  SequenceVersionChangeType,
  SequenceExecutionStatus,
} from '@borradh-workspace/labels';

// Database enums
export const sequenceStepTypeEnum = pgEnum(
  'sequence_step_type',
  sequenceStepTypeValues
);

export const sequenceVersionChangeTypeEnum = pgEnum(
  'sequence_version_change_type',
  sequenceVersionChangeTypeValues
);

export const sequenceExecutionStatusEnum = pgEnum(
  'sequence_execution_status',
  sequenceExecutionStatusValues
);

export const sequence = pgTable(
  'sequence',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => createId()),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    description: text('description'),
    isActive: boolean('is_active').default(false),
    triggerOnNewLead: boolean('trigger_on_new_lead').default(true),
    scheduleNextDay: boolean('schedule_next_day').default(false),
    setupCompleted: boolean('setup_completed').default(false).notNull(),
    nodes: jsonb('nodes'),
    edges: jsonb('edges'),
    settings: jsonb('settings'),
    createdById: text('created_by_id').references(() => user.id, {
      onDelete: 'set null',
    }),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at')
      .defaultNow()
      .notNull()
      .$onUpdate(() => new Date()),
    deletedAt: timestamp('deleted_at'),
  },
  (table) => [
    index('idx_sequence_org_id').on(table.organizationId),
    index('idx_sequence_created_by_id').on(table.createdById),
  ]
);

export const sequenceRlsPolicy = orgRlsPolicy(sequence);

export const sequenceVersion = pgTable(
  'sequence_version',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => createId()),
    sequenceId: text('sequence_id')
      .notNull()
      .references(() => sequence.id, { onDelete: 'cascade' }),
    version: integer('version').notNull(),
    nodes: jsonb('nodes').notNull(),
    edges: jsonb('edges').notNull(),
    changeType: sequenceVersionChangeTypeEnum('change_type').notNull(),
    changeSummary: text('change_summary'),
    createdById: text('created_by_id').references(() => user.id, {
      onDelete: 'set null',
    }),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [index('idx_sequence_version_sequence_id').on(table.sequenceId)]
);

export const sequenceStep = pgTable(
  'sequence_step',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => createId()),
    sequenceId: text('sequence_id')
      .notNull()
      .references(() => sequence.id, { onDelete: 'cascade' }),
    nodeId: text('node_id').notNull(),
    type: sequenceStepTypeEnum('type').notNull(),
    config: jsonb('config').notNull(),
    order: integer('order').notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [index('idx_sequence_step_sequence_id').on(table.sequenceId)]
);

export const sequenceExecution = pgTable(
  'sequence_execution',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => createId()),
    leadId: text('lead_id')
      .notNull()
      .references(() => lead.id, { onDelete: 'cascade' }),
    sequenceId: text('sequence_id')
      .notNull()
      .references(() => sequence.id, { onDelete: 'cascade' }),
    stepId: text('step_id')
      .notNull()
      .references(() => sequenceStep.id),
    status: sequenceExecutionStatusEnum('status').notNull().default('pending'),
    result: jsonb('result'),
    scheduledAt: timestamp('scheduled_at'),
    executedAt: timestamp('executed_at'),
    errorMessage: text('error_message'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [
    index('idx_sequence_execution_lead_id').on(table.leadId),
    index('idx_sequence_execution_sequence_id').on(table.sequenceId),
  ]
);

export const leadActivity = pgTable(
  'lead_activity',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => createId()),
    leadId: text('lead_id')
      .notNull()
      .references(() => lead.id, { onDelete: 'cascade' }),
    type: text('type').notNull(),
    description: text('description'),
    metadata: jsonb('metadata'),
    performedById: text('performed_by_id').references(() => user.id, {
      onDelete: 'set null',
    }),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [index('idx_lead_activity_lead_id').on(table.leadId)]
);

// =============================================================================
// RLS POLICIES
// =============================================================================

// Bucket A: sequence has organization_id → standard policy (already above).

// Bucket B1: sequence_version, sequence_step, sequence_execution, and
// lead_activity have no organization_id. Org scope derives from the sequence
// (or lead) parent row via the FK.

// sequence_version → parent: sequence, fk: sequence_id
export const sequenceVersionRlsPolicy = childOrgRlsPolicy(sequenceVersion, {
  parent: 'sequence',
  fk: 'sequence_id',
});

// sequence_step → parent: sequence, fk: sequence_id
export const sequenceStepRlsPolicy = childOrgRlsPolicy(sequenceStep, {
  parent: 'sequence',
  fk: 'sequence_id',
});

// sequence_execution → parent: sequence, fk: sequence_id (also has lead_id,
// but sequence carries org directly and has an index on it).
export const sequenceExecutionRlsPolicy = childOrgRlsPolicy(sequenceExecution, {
  parent: 'sequence',
  fk: 'sequence_id',
});

// lead_activity → parent: lead, fk: lead_id (lead has organization_id).
export const leadActivityRlsPolicy = childOrgRlsPolicy(leadActivity, {
  parent: 'lead',
  fk: 'lead_id',
});

// =============================================================================
// TYPES
// =============================================================================

export type Sequence = typeof sequence.$inferSelect;
export type NewSequence = typeof sequence.$inferInsert;
export type SequenceVersion = typeof sequenceVersion.$inferSelect;
export type NewSequenceVersion = typeof sequenceVersion.$inferInsert;
export type SequenceStep = typeof sequenceStep.$inferSelect;
export type NewSequenceStep = typeof sequenceStep.$inferInsert;
export type SequenceExecution = typeof sequenceExecution.$inferSelect;
export type NewSequenceExecution = typeof sequenceExecution.$inferInsert;
export type LeadActivity = typeof leadActivity.$inferSelect;
export type NewLeadActivity = typeof leadActivity.$inferInsert;
