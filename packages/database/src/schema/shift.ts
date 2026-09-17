import { createId } from '@paralleldrive/cuid2';
import { relations } from 'drizzle-orm';
import {
  boolean,
  date,
  index,
  integer,
  pgTable,
  text,
  timestamp,
} from 'drizzle-orm/pg-core';
import { orgRlsPolicy } from '../rls-policy.js';
import { organizationLocation } from './organization-location.js';
import { organization } from './organization.js';
import { practitioner } from './practitioners.js';

/**
 * Practitioner shifts — one row per interval. Two row kinds in one table:
 *
 * - Weekly pattern row: `dayOfWeek` NOT NULL (0=Sunday..6=Saturday, matching
 *   `WorkingHours`), `date` NULL.
 * - Date override row: `date` NOT NULL, `dayOfWeek` NULL.
 *
 * Override semantics (frozen): if ANY override rows exist for
 * (practitionerId, date), they replace ALL weekly rows for that practitioner
 * for that date's weekday. "No shift this day" = a single override row with
 * `isOff=true` and null minutes. Multiple intervals per day = multiple rows.
 *
 * Invariants (enforced in Zod, not DB checks): exactly one of dayOfWeek/date
 * set; isOff=true ⇒ minutes null; isOff=false ⇒ 0 <= start < end <= 1440;
 * intervals for the same (practitioner, day) must not overlap.
 */
export const shift = pgTable(
  'shift',
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
    // null = any/all locations
    locationId: text('location_id').references(() => organizationLocation.id, {
      onDelete: 'set null',
    }),
    // 0–6; NULL on override rows
    dayOfWeek: integer('day_of_week'),
    // NULL on weekly rows
    date: date('date'),
    // Minutes from midnight; NULL only when isOff
    startMinutes: integer('start_minutes'),
    endMinutes: integer('end_minutes'),
    // Override row meaning "no shift this day"
    isOff: boolean('is_off').notNull().default(false),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at')
      .defaultNow()
      .notNull()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    index('idx_shift_org_practitioner_dow').on(
      table.organizationId,
      table.practitionerId,
      table.dayOfWeek
    ),
    index('idx_shift_org_practitioner_date').on(
      table.organizationId,
      table.practitionerId,
      table.date
    ),
  ]
);

export const shiftRlsPolicy = orgRlsPolicy(shift);

export const shiftRelations = relations(shift, ({ one }) => ({
  organization: one(organization, {
    fields: [shift.organizationId],
    references: [organization.id],
  }),
  practitioner: one(practitioner, {
    fields: [shift.practitionerId],
    references: [practitioner.id],
  }),
  location: one(organizationLocation, {
    fields: [shift.locationId],
    references: [organizationLocation.id],
  }),
}));

export type Shift = typeof shift.$inferSelect;
export type NewShift = typeof shift.$inferInsert;
