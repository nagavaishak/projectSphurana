import { createId } from '@paralleldrive/cuid2';
import { relations } from 'drizzle-orm';
import {
  boolean,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  unique,
} from 'drizzle-orm/pg-core';
import {
  childOrgRlsPolicy,
  joinRlsPolicy,
  orgRlsPolicy,
} from '../rls-policy.js';
import { organizationLocation } from './organization-location.js';
import { organization } from './organization.js';
import { practitioner } from './practitioners.js';
import { user } from './user.js';

/**
 * Reusable blocked-time presets (e.g. Lunch, Training, Meeting).
 * Seeded per org by `seedBlockedTimeTypes` (features/scheduling).
 */
export const blockedTimeType = pgTable(
  'blocked_time_type',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => createId()),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    // Zod: int().multipleOf(5).min(5).max(535)
    durationMinutes: integer('duration_minutes').notNull(),
    paid: boolean('paid').notNull().default(false),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at')
      .defaultNow()
      .notNull()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    unique('blocked_time_type_org_name_unique').on(
      table.organizationId,
      table.name
    ),
  ]
);

export const blockedTimeTypeRlsPolicy = orgRlsPolicy(blockedTimeType);

/**
 * Blocked time — replaces `practitioner_unavailability` (kept until frontend
 * cutover; see docs/fresha-clone-contracts.md §1.1).
 */
export const blockedTime = pgTable(
  'blocked_time',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => createId()),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
    // null = ad-hoc block (no preset type)
    blockedTimeTypeId: text('blocked_time_type_id').references(
      () => blockedTimeType.id,
      { onDelete: 'set null' }
    ),
    // The branch this block applies to. NULL = applies to EVERY branch —
    // that is the meaning of the null, not "unknown", so this column stays
    // nullable permanently (unlike appointment.location_id).
    locationId: text('location_id').references(() => organizationLocation.id, {
      onDelete: 'set null',
    }),
    title: text('title').notNull(),
    description: text('description'),
    startDate: timestamp('start_date', { withTimezone: true }).notNull(),
    endDate: timestamp('end_date', { withTimezone: true }).notNull(),
    allDay: boolean('all_day').notNull().default(false),
    timezone: text('timezone').notNull().default('UTC'),
    // RFC 5545 RRULE body (e.g. "FREQ=WEEKLY;BYDAY=MO,WE"), null = single occurrence
    rrule: text('rrule'),
    // Mirrors UNTIL from rrule for cheap SQL pre-filtering
    recurrenceEndDate: timestamp('recurrence_end_date', { withTimezone: true }),
    // Copied from the type at creation; editable per block
    paid: boolean('paid').notNull().default(false),
    createdById: text('created_by_id')
      .notNull()
      .references(() => user.id, { onDelete: 'restrict' }),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at')
      .defaultNow()
      .notNull()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    index('idx_blocked_time_org_start').on(
      table.organizationId,
      table.startDate
    ),
    index('idx_blocked_time_org_recurrence_end').on(
      table.organizationId,
      table.recurrenceEndDate
    ),
    index('idx_blocked_time_location_id').on(table.locationId),
  ]
);

export const blockedTimeRlsPolicy = orgRlsPolicy(blockedTime);

/**
 * Practitioners a blocked time applies to.
 * ZERO rows for a blocked_time = org-wide block (applies to all practitioners),
 * mirroring the old `practitionerId IS NULL` semantics.
 */
export const blockedTimePractitioner = pgTable(
  'blocked_time_practitioner',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => createId()),
    blockedTimeId: text('blocked_time_id')
      .notNull()
      .references(() => blockedTime.id, { onDelete: 'cascade' }),
    practitionerId: text('practitioner_id')
      .notNull()
      .references(() => practitioner.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [
    unique('blocked_time_practitioner_unique').on(
      table.blockedTimeId,
      table.practitionerId
    ),
    index('idx_blocked_time_practitioner_practitioner_id').on(
      table.practitionerId
    ),
  ]
);

export const blockedTimePractitionerRlsPolicy = joinRlsPolicy(
  blockedTimePractitioner,
  {
    parent: 'blocked_time',
    fk: 'blocked_time_id',
  }
);

/**
 * Per-occurrence exception for a recurring blocked time (RFC 5545
 * RECURRENCE-ID semantics). Mirror of `practitioner_unavailability_exception`.
 */
export const blockedTimeException = pgTable(
  'blocked_time_exception',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => createId()),
    blockedTimeId: text('blocked_time_id')
      .notNull()
      .references(() => blockedTime.id, { onDelete: 'cascade' }),
    originalStart: timestamp('original_start', {
      withTimezone: true,
    }).notNull(),
    cancelled: boolean('cancelled').notNull().default(false),
    startDate: timestamp('start_date', { withTimezone: true }),
    endDate: timestamp('end_date', { withTimezone: true }),
    title: text('title'),
    description: text('description'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at')
      .defaultNow()
      .notNull()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    unique('blocked_time_exception_unique').on(
      table.blockedTimeId,
      table.originalStart
    ),
  ]
);

export const blockedTimeExceptionRlsPolicy = childOrgRlsPolicy(
  blockedTimeException,
  {
    parent: 'blocked_time',
    fk: 'blocked_time_id',
  }
);

export const blockedTimeTypeRelations = relations(
  blockedTimeType,
  ({ one, many }) => ({
    organization: one(organization, {
      fields: [blockedTimeType.organizationId],
      references: [organization.id],
    }),
    blockedTimes: many(blockedTime),
  })
);

export const blockedTimeRelations = relations(blockedTime, ({ one, many }) => ({
  organization: one(organization, {
    fields: [blockedTime.organizationId],
    references: [organization.id],
  }),
  type: one(blockedTimeType, {
    fields: [blockedTime.blockedTimeTypeId],
    references: [blockedTimeType.id],
  }),
  location: one(organizationLocation, {
    fields: [blockedTime.locationId],
    references: [organizationLocation.id],
  }),
  createdBy: one(user, {
    fields: [blockedTime.createdById],
    references: [user.id],
  }),
  practitioners: many(blockedTimePractitioner),
  exceptions: many(blockedTimeException),
}));

export const blockedTimePractitionerRelations = relations(
  blockedTimePractitioner,
  ({ one }) => ({
    blockedTime: one(blockedTime, {
      fields: [blockedTimePractitioner.blockedTimeId],
      references: [blockedTime.id],
    }),
    practitioner: one(practitioner, {
      fields: [blockedTimePractitioner.practitionerId],
      references: [practitioner.id],
    }),
  })
);

export const blockedTimeExceptionRelations = relations(
  blockedTimeException,
  ({ one }) => ({
    blockedTime: one(blockedTime, {
      fields: [blockedTimeException.blockedTimeId],
      references: [blockedTime.id],
    }),
  })
);

export type BlockedTimeType = typeof blockedTimeType.$inferSelect;
export type NewBlockedTimeType = typeof blockedTimeType.$inferInsert;
export type BlockedTime = typeof blockedTime.$inferSelect;
export type NewBlockedTime = typeof blockedTime.$inferInsert;
export type BlockedTimePractitioner =
  typeof blockedTimePractitioner.$inferSelect;
export type NewBlockedTimePractitioner =
  typeof blockedTimePractitioner.$inferInsert;
export type BlockedTimeException = typeof blockedTimeException.$inferSelect;
export type NewBlockedTimeException = typeof blockedTimeException.$inferInsert;
