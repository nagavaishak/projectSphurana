import { createId } from '@paralleldrive/cuid2';
import { relations, sql } from 'drizzle-orm';
import {
  index,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { childOrgRlsPolicy, orgRlsPolicy } from '../rls-policy.js';
import { organization } from './organization.js';
import { practitioner } from './practitioners.js';

// Import labels from enums (pure TypeScript)
import {
  timeEntrySourceLabels,
  timeEntrySourceValues,
  timeEntryStatusLabels,
  timeEntryStatusValues,
} from '@borradh-workspace/labels';

// Re-export labels and types for consumers
export {
  timeEntrySourceLabels,
  timeEntrySourceValues,
  timeEntryStatusLabels,
  timeEntryStatusValues,
};
export type {
  TimeEntrySource,
  TimeEntryStatus,
} from '@borradh-workspace/labels';

// Database enums
export const timeEntrySourceEnum = pgEnum(
  'time_entry_source',
  timeEntrySourceValues
);
export const timeEntryStatusEnum = pgEnum(
  'time_entry_status',
  timeEntryStatusValues
);

export const timeEntry = pgTable(
  'time_entry',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => createId()),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
    practitionerId: text('practitioner_id')
      .notNull()
      .references(() => practitioner.id, { onDelete: 'cascade' }),
    clockIn: timestamp('clock_in', { withTimezone: true }).notNull(),
    // NULL = currently clocked in
    clockOut: timestamp('clock_out', { withTimezone: true }),
    source: timeEntrySourceEnum('source').notNull().default('manual'),
    // open while clocked in, completed on clock-out, approved by manager
    status: timeEntryStatusEnum('status').notNull().default('open'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at')
      .defaultNow()
      .notNull()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    index('idx_time_entry_org_practitioner_clock_in').on(
      table.organizationId,
      table.practitionerId,
      table.clockIn
    ),
    // A practitioner can have at most one OPEN entry at a time — enforces the
    // single-open-entry invariant at the DB level (backstop to the app guard).
    uniqueIndex('uq_time_entry_open_per_practitioner')
      .on(table.practitionerId)
      .where(sql`${table.clockOut} IS NULL`),
  ]
);

export const timeEntryRlsPolicy = orgRlsPolicy(timeEntry);

// NOTE: time_entry_break has no organization_id; org scope derives from the
// parent time_entry row via time_entry_id FK.
export const timeEntryBreak = pgTable(
  'time_entry_break',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => createId()),
    timeEntryId: text('time_entry_id')
      .notNull()
      .references(() => timeEntry.id, { onDelete: 'cascade' }),
    breakStart: timestamp('break_start', { withTimezone: true }).notNull(),
    // NULL = break in progress
    breakEnd: timestamp('break_end', { withTimezone: true }),
    source: timeEntrySourceEnum('source').notNull().default('manual'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at')
      .defaultNow()
      .notNull()
      .$onUpdate(() => new Date()),
  },
  (table) => [index('idx_time_entry_break_entry_id').on(table.timeEntryId)]
);

export const timeEntryBreakRlsPolicy = childOrgRlsPolicy(timeEntryBreak, {
  parent: 'time_entry',
  fk: 'time_entry_id',
});

export const timeEntryRelations = relations(timeEntry, ({ one, many }) => ({
  organization: one(organization, {
    fields: [timeEntry.organizationId],
    references: [organization.id],
  }),
  practitioner: one(practitioner, {
    fields: [timeEntry.practitionerId],
    references: [practitioner.id],
  }),
  breaks: many(timeEntryBreak),
}));

export const timeEntryBreakRelations = relations(timeEntryBreak, ({ one }) => ({
  timeEntry: one(timeEntry, {
    fields: [timeEntryBreak.timeEntryId],
    references: [timeEntry.id],
  }),
}));

export type TimeEntry = typeof timeEntry.$inferSelect;
export type NewTimeEntry = typeof timeEntry.$inferInsert;
export type TimeEntryBreak = typeof timeEntryBreak.$inferSelect;
export type NewTimeEntryBreak = typeof timeEntryBreak.$inferInsert;
