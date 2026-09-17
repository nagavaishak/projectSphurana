import { createId } from '@paralleldrive/cuid2';
import { relations } from 'drizzle-orm';
import { sql } from 'drizzle-orm';
import {
  boolean,
  index,
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
} from 'drizzle-orm/pg-core';
import {
  joinRlsPolicy,
  orgRlsPolicy,
  patientSelfRlsPolicy,
} from '../rls-policy.js';
import { calendarAccount } from './calendar-accounts.js';
import { lead } from './leads.js';
import { organizationLocation } from './organization-location.js';
import { organizationService } from './organization-service.js';
import { organization } from './organization.js';
import { practitioner } from './practitioners.js';
import { user } from './user.js';

// Import labels from enums (pure TypeScript)
import {
  appointmentColorLabels,
  appointmentColorValues,
  appointmentSourceLabels,
  appointmentSourceValues,
  appointmentStatusLabels,
  appointmentStatusValues,
} from '@borradh-workspace/labels';

// Re-export labels and types for consumers
export {
  appointmentStatusLabels,
  appointmentStatusValues,
  appointmentSourceLabels,
  appointmentSourceValues,
  appointmentColorLabels,
  appointmentColorValues,
};
export type {
  AppointmentStatus,
  AppointmentSource,
  AppointmentColor,
} from '@borradh-workspace/labels';

// Database enums
export const appointmentStatusEnum = pgEnum(
  'appointment_status',
  appointmentStatusValues
);
export const appointmentSourceEnum = pgEnum(
  'appointment_source',
  appointmentSourceValues
);
export const appointmentColorEnum = pgEnum(
  'appointment_color',
  appointmentColorValues
);

export const appointment = pgTable(
  'appointment',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => createId()),

    // Required fields
    title: text('title').notNull(),
    // Real UTC instants (timestamptz), matching blocked_time / time_off and the
    // availability resolver. Rendered in organization.timezone on the client.
    startDate: timestamp('start_date', { withTimezone: true }).notNull(),
    endDate: timestamp('end_date', { withTimezone: true }).notNull(),

    // Optional fields
    description: text('description'),

    // Enum fields
    color: appointmentColorEnum('color').notNull().default('blue'),
    status: appointmentStatusEnum('status').notNull().default('booked'),
    source: appointmentSourceEnum('source').notNull().default('manual'),

    // Foreign keys
    leadId: text('lead_id')
      .notNull()
      .references(() => lead.id, { onDelete: 'cascade' }),
    // Nullable + set null on user delete: removing a staff member must NOT
    // cascade-delete their (possibly historical/financial) appointments. Mirrors
    // practitionerId. Still always populated on create by the write paths.
    assignedToId: text('assigned_to_id').references(() => user.id, {
      onDelete: 'set null',
    }),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),

    // The branch the appointment happens at. An appointment happens at exactly
    // ONE location, so this is a single FK rather than a join table (see
    // docs/plans/location-focused-redesign.md §2.2.1).
    //
    // Nullable for now: it lands additive, is backfilled to the org's primary
    // location, and is tightened to NOT NULL in a follow-up migration once prod
    // is clean. `set null` (not cascade) so deleting a branch never destroys
    // historical/financial appointment rows.
    locationId: text('location_id').references(() => organizationLocation.id, {
      onDelete: 'set null',
    }),

    // Practitioner assignment
    practitionerId: text('practitioner_id').references(() => practitioner.id, {
      onDelete: 'set null',
    }),

    // Optional link to the catalog service the appointment was booked from.
    // Lets the calendar filter by service and surface duration / category
    // metadata without parsing the title.
    serviceId: text('service_id').references(() => organizationService.id, {
      onDelete: 'set null',
    }),

    // Calendar sync
    calendarAccountId: text('calendar_account_id').references(
      () => calendarAccount.id,
      { onDelete: 'set null' }
    ),
    externalCalendarEventId: text('external_calendar_event_id'),

    // Deposit tracking
    depositRequired: boolean('deposit_required').notNull().default(false),

    // When a `held` slot is released. Set wherever a hold is created — Claire
    // holding a slot mid-conversation, or a booking awaiting its deposit — and
    // cleared when the hold resolves into a real booking.
    //
    // The clock lives HERE rather than on `appointment_deposit` so that a hold
    // taking no payment still expires. Without it, Claire's bookings blocked
    // their slot forever once the customer stopped replying.
    holdExpiresAt: timestamp('hold_expires_at', { withTimezone: true }),

    // Double-booking policy. Staff/manual bookings set this true so they may
    // deliberately overlap (Fresha-style). Online paths (booking_form,
    // ai_voice_caller) leave it false, which subjects the row to the
    // `appointment_no_overlap` partial exclusion constraint — the DB backstop
    // that prevents concurrent online bookings from double-booking a
    // practitioner (see migration: appointment_no_overlap_exclusion).
    allowDoubleBooking: boolean('allow_double_booking')
      .notNull()
      .default(false),

    // Reminder tracking
    reminderSentAt24h: timestamp('reminder_sent_at_24h'),
    reminderSentAt1h: timestamp('reminder_sent_at_1h'),

    // Timestamps
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at')
      .defaultNow()
      .notNull()
      .$onUpdate(() => new Date()),
    deletedAt: timestamp('deleted_at'),
  },
  (table) => [
    index('idx_appointment_org_id').on(table.organizationId),
    index('idx_appointment_lead_id').on(table.leadId),
    index('idx_appointment_assigned_to_id').on(table.assignedToId),
    index('idx_appointment_practitioner_id').on(table.practitionerId),
    index('idx_appointment_calendar_account_id').on(table.calendarAccountId),
    index('idx_appointment_service_id').on(table.serviceId),
    index('idx_appointment_location_id').on(table.locationId),
    // The location-scoped calendar: WHERE organization_id = ? AND location_id
    // = ? AND deleted_at IS NULL AND start_date BETWEEN ? AND ?. Mirrors
    // idx_appointment_org_start with the branch dimension in front of the range.
    index('idx_appointment_org_location_start')
      .on(table.organizationId, table.locationId, table.startDate)
      .where(sql`${table.deletedAt} IS NULL`),
    // Calendar/agenda list: WHERE organization_id = ? AND deleted_at IS NULL
    // AND start_date BETWEEN ? AND ? ORDER BY start_date. Composite + partial so
    // the planner range-scans this org's live appointments instead of scanning
    // all of them and filtering the date range in memory.
    index('idx_appointment_org_start')
      .on(table.organizationId, table.startDate)
      .where(sql`${table.deletedAt} IS NULL`),
    // expire-appointment-holds cron: WHERE status = 'held' AND hold_expires_at
    // < now. Partial so it indexes only live holds, which is a handful of rows.
    index('idx_appointment_hold_expires')
      .on(table.holdExpiresAt)
      .where(sql`${table.holdExpiresAt} IS NOT NULL`),
    // Availability resolver: WHERE organization_id = ? AND practitioner_id IN (…)
    // AND start_date < to AND end_date > from. Leads with org+practitioner+start.
    index('idx_appointment_org_practitioner_start')
      .on(table.organizationId, table.practitionerId, table.startDate)
      .where(sql`${table.deletedAt} IS NULL`),
    // Reminder cron: scans by start_date window where the reminder flag is still
    // null. Partial indexes keep these tiny (only un-reminded live rows).
    index('idx_appointment_reminder_24h')
      .on(table.startDate)
      .where(
        sql`${table.deletedAt} IS NULL AND ${table.reminderSentAt24h} IS NULL`
      ),
    index('idx_appointment_reminder_1h')
      .on(table.startDate)
      .where(
        sql`${table.deletedAt} IS NULL AND ${table.reminderSentAt1h} IS NULL`
      ),
  ]
);

export const appointmentRelations = relations(appointment, ({ one, many }) => ({
  // The full cart. `appointment.service` (singular, below) remains the PRIMARY
  // service — line item 0 — so existing single-service readers keep working.
  services: many(appointmentService),
  lead: one(lead, {
    fields: [appointment.leadId],
    references: [lead.id],
  }),
  assignedTo: one(user, {
    fields: [appointment.assignedToId],
    references: [user.id],
  }),
  practitioner: one(practitioner, {
    fields: [appointment.practitionerId],
    references: [practitioner.id],
  }),
  service: one(organizationService, {
    fields: [appointment.serviceId],
    references: [organizationService.id],
  }),
  organization: one(organization, {
    fields: [appointment.organizationId],
    references: [organization.id],
  }),
  location: one(organizationLocation, {
    fields: [appointment.locationId],
    references: [organizationLocation.id],
  }),
  calendarAccount: one(calendarAccount, {
    fields: [appointment.calendarAccountId],
    references: [calendarAccount.id],
  }),
}));

export const appointmentRlsPolicy = orgRlsPolicy(appointment);
/** Patient portal (ENG-647): a signed-in patient reads their OWN
 * appointments. Auxiliary policy, TO app_patient only. */
export const appointmentPatientSelfPolicy = patientSelfRlsPolicy(appointment);

export type Appointment = typeof appointment.$inferSelect;
export type NewAppointment = typeof appointment.$inferInsert;

// =============================================================================
// appointment_service — the services that make up one appointment (the "cart")
// =============================================================================

/**
 * The services that make up one appointment — the Fresha cart.
 *
 * The appointment stays ONE row with one start/end, which is what keeps the
 * `appointment_no_overlap` exclusion constraint working (split a cart into N
 * appointment rows and the constraint would reject the cart's own line items as
 * overlapping each other). The services it contains are line items here.
 *
 * `appointment.serviceId` above is retained as a denormalised pointer to the
 * FIRST line item ("primary service"), so every existing single-service reader
 * — calendar filter, reminder email, reschedule — keeps working untouched.
 *
 * Snapshots, not just FKs — mirroring `sale_item`: `name`, `durationMinutes`
 * and `priceCents` are copied at booking time, so renaming a service,
 * re-pricing it, or deleting it (serviceId is SET NULL) never rewrites the
 * history of an appointment that already happened.
 *
 * Colocated with `appointment` rather than in its own file because the relation
 * is mutual (appointment.services ↔ appointmentService.appointment) and a
 * separate module would be a circular import. Same reason `sale_item` lives
 * next to `sale`.
 */
export const appointmentService = pgTable(
  'appointment_service',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => createId()),

    appointmentId: text('appointment_id')
      .notNull()
      .references(() => appointment.id, { onDelete: 'cascade' }),

    // SET NULL, not cascade: deleting a service from the catalog must not
    // delete the line items of appointments that already used it.
    serviceId: text('service_id').references(() => organizationService.id, {
      onDelete: 'set null',
    }),

    // Snapshot of the service at booking time (survives rename/delete/reprice).
    name: text('name').notNull(),
    durationMinutes: integer('duration_minutes').notNull(),
    priceCents: integer('price_cents'),

    // Per-line practitioner. Today every line inherits the appointment's single
    // practitioner, but Fresha lets each service be done by a different person;
    // modelling it per-line now makes that a UI change later, not a migration.
    practitionerId: text('practitioner_id').references(() => practitioner.id, {
      onDelete: 'set null',
    }),

    // The order the customer picked them in = the order they're performed in.
    sortOrder: integer('sort_order').notNull().default(0),

    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (table) => [
    // The only read: WHERE appointment_id = ? ORDER BY sort_order
    index('idx_appointment_service_appointment').on(
      table.appointmentId,
      table.sortOrder
    ),
    // The calendar's "filter by service" must match ANY line item, not only the
    // primary one — that lookup goes serviceId -> appointmentIds.
    index('idx_appointment_service_service').on(table.serviceId),
  ]
);

// Bucket B join table: org scope inherited from `appointment`, which carries
// organization_id and is indexed on it. app_public is included (the helper's
// default) so the public booking flow can INSERT line items inside
// withPublicOrgScope.
export const appointmentServiceRlsPolicy = joinRlsPolicy(appointmentService, {
  parent: 'appointment',
  fk: 'appointment_id',
});

export const appointmentServiceRelations = relations(
  appointmentService,
  ({ one }) => ({
    appointment: one(appointment, {
      fields: [appointmentService.appointmentId],
      references: [appointment.id],
    }),
    service: one(organizationService, {
      fields: [appointmentService.serviceId],
      references: [organizationService.id],
    }),
    practitioner: one(practitioner, {
      fields: [appointmentService.practitionerId],
      references: [practitioner.id],
    }),
  })
);

export type AppointmentService = typeof appointmentService.$inferSelect;
export type NewAppointmentService = typeof appointmentService.$inferInsert;
