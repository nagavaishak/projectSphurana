import {
  timeOffTypeLabels,
  timeOffTypeValues,
} from '@borradh-workspace/labels';
import { createId } from '@paralleldrive/cuid2';
import { relations } from 'drizzle-orm';
import {
  boolean,
  index,
  pgEnum,
  pgTable,
  text,
  timestamp,
} from 'drizzle-orm/pg-core';
import { orgRlsPolicy } from '../rls-policy.js';
import { organizationLocation } from './organization-location.js';
import { organization } from './organization.js';
import { practitioner } from './practitioners.js';
import { user } from './user.js';

// Re-export labels and types for consumers
export { timeOffTypeLabels, timeOffTypeValues };
export type { TimeOffType } from '@borradh-workspace/labels';

export const timeOffTypeEnum = pgEnum('time_off_type', timeOffTypeValues);

/**
 * Practitioner time off (annual leave, sick leave, training, other).
 * Repeat is stored as `rrule` + `recurrence_end_date` to reuse the existing
 * recurrence expansion code path.
 */
export const timeOff = pgTable(
  'time_off',
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
    // The branch this time off applies to. NULL = applies to EVERY branch
    // (the practitioner is away from the whole business), which is the normal
    // case — so this column stays nullable permanently.
    locationId: text('location_id').references(() => organizationLocation.id, {
      onDelete: 'set null',
    }),
    type: timeOffTypeEnum('type').notNull().default('annual_leave'),
    startDate: timestamp('start_date', { withTimezone: true }).notNull(),
    endDate: timestamp('end_date', { withTimezone: true }).notNull(),
    allDay: boolean('all_day').notNull().default(true),
    timezone: text('timezone').notNull().default('UTC'),
    // RFC 5545 RRULE body, null = one-off
    rrule: text('rrule'),
    // repeatUntilDate — mirrors UNTIL for cheap SQL pre-filtering
    recurrenceEndDate: timestamp('recurrence_end_date', { withTimezone: true }),
    description: text('description'),
    // Defaults true: today only managers create time off; an approval flow can
    // flip the default later without schema change.
    approved: boolean('approved').notNull().default(true),
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
    index('idx_time_off_org_practitioner_start').on(
      table.organizationId,
      table.practitionerId,
      table.startDate
    ),
    index('idx_time_off_location_id').on(table.locationId),
  ]
);

export const timeOffRlsPolicy = orgRlsPolicy(timeOff);

export const timeOffRelations = relations(timeOff, ({ one }) => ({
  organization: one(organization, {
    fields: [timeOff.organizationId],
    references: [organization.id],
  }),
  practitioner: one(practitioner, {
    fields: [timeOff.practitionerId],
    references: [practitioner.id],
  }),
  location: one(organizationLocation, {
    fields: [timeOff.locationId],
    references: [organizationLocation.id],
  }),
  createdBy: one(user, {
    fields: [timeOff.createdById],
    references: [user.id],
  }),
}));

export type TimeOff = typeof timeOff.$inferSelect;
export type NewTimeOff = typeof timeOff.$inferInsert;
