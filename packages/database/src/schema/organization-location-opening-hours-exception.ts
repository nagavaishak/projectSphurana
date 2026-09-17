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
  unique,
} from 'drizzle-orm/pg-core';
import { childOrgRlsPolicy } from '../rls-policy.js';
import { organizationLocation } from './organization-location.js';
import { user } from './user.js';

/**
 * Per-date override for a location's standing opening hours.
 *
 * Mirrors the practitioner_unavailability_exception pattern: standing
 * schedule lives on the parent (organization_location.openingHours),
 * and one-off changes are recorded here keyed by date.
 *
 * - closed=true → location is closed that day, ignore from/to
 * - closed=false → use from/to as the opening hours for that date
 */
export const organizationLocationOpeningHoursException = pgTable(
  'org_location_opening_hours_exception',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => createId()),
    locationId: text('location_id')
      .notNull()
      .references(() => organizationLocation.id, { onDelete: 'cascade' }),
    // The specific calendar date being overridden (location timezone).
    date: date('date').notNull(),
    closed: boolean('closed').notNull().default(false),
    // Minutes from midnight, only used when closed=false.
    fromMinutes: integer('from_minutes'),
    toMinutes: integer('to_minutes'),
    note: text('note'),
    createdById: text('created_by_id').references(() => user.id, {
      onDelete: 'set null',
    }),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at')
      .defaultNow()
      .notNull()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    unique('opening_hours_exception_unique').on(table.locationId, table.date),
    index('idx_opening_hours_exception_location_date').on(
      table.locationId,
      table.date
    ),
  ]
);

export const organizationLocationOpeningHoursExceptionRelations = relations(
  organizationLocationOpeningHoursException,
  ({ one }) => ({
    location: one(organizationLocation, {
      fields: [organizationLocationOpeningHoursException.locationId],
      references: [organizationLocation.id],
    }),
    createdBy: one(user, {
      fields: [organizationLocationOpeningHoursException.createdById],
      references: [user.id],
    }),
  })
);

// Bucket B1: org_location_opening_hours_exception has no organization_id; org
// scope derives from the parent organization_location row via location_id FK.
export const organizationLocationOpeningHoursExceptionRlsPolicy =
  childOrgRlsPolicy(organizationLocationOpeningHoursException, {
    parent: 'organization_location',
    fk: 'location_id',
  });

export type OrganizationLocationOpeningHoursException =
  typeof organizationLocationOpeningHoursException.$inferSelect;
export type NewOrganizationLocationOpeningHoursException =
  typeof organizationLocationOpeningHoursException.$inferInsert;
