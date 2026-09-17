import { createId } from '@paralleldrive/cuid2';
import { relations } from 'drizzle-orm';
import { index, pgTable, text, timestamp } from 'drizzle-orm/pg-core';
import { orgRlsPolicy } from '../rls-policy.js';
import { appointment } from './appointments.js';
import { organization } from './organization.js';

// =============================================================================
// TABLES
// =============================================================================

/**
 * AppointmentManageToken — the capability that lets a patient act on their own
 * booking without an account. Emitted at booking time and embedded in the
 * confirmation + reminder emails as
 * `/book/:organizationSlug/manage/:token`.
 *
 * ⚠️  This is a bearer credential handed to an unauthenticated stranger, so:
 *
 *  - We store `tokenHash` (SHA-256), never the token. A database leak must not
 *    yield working cancel/reschedule links for every future booking.
 *  - The URL carries the org slug alongside the token. That is not decoration:
 *    `appointment` is under `orgRlsPolicy`, so a read needs org context BEFORE
 *    the row can be seen. The slug bootstraps that context (via
 *    `withPublicOrgScope`), and the token is then matched *within* the org.
 *    Without the slug we would need a policy that reads appointments with no
 *    org context at all — a hole far worse than the feature is worth.
 *  - Not single-use. A patient may legitimately reschedule twice, or open the
 *    link, close it, and come back. Cancellation is what ends a token's life
 *    (the appointment is terminal), not first use.
 *
 * `expiresAt` is set past the appointment end rather than at it, so someone who
 * no-showed can still be told what happened instead of hitting a dead link.
 */
export const appointmentManageToken = pgTable(
  'appointment_manage_token',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => createId()),

    organizationId: text('organization_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),

    // One live token per appointment. Cascade: a deleted appointment must not
    // leave a working capability behind.
    appointmentId: text('appointment_id')
      .notNull()
      .references(() => appointment.id, { onDelete: 'cascade' }),

    // SHA-256 of the raw token. Unique so a lookup is a single indexed probe
    // and so we cannot accidentally issue the same capability twice.
    tokenHash: text('token_hash').notNull().unique(),

    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),

    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [
    // Lookup path: given (org, tokenHash) → the appointment.
    index('idx_appointment_manage_token_org_hash').on(
      table.organizationId,
      table.tokenHash
    ),
    // "Does this appointment already have a token?" — the issue path.
    index('idx_appointment_manage_token_appointment_id').on(
      table.appointmentId
    ),
    // Cleanup-cron scan path.
    index('idx_appointment_manage_token_expires_at').on(table.expiresAt),
  ]
);

// =============================================================================
// RLS POLICIES
// =============================================================================

export const appointmentManageTokenRlsPolicy = orgRlsPolicy(
  appointmentManageToken
);

// =============================================================================
// RELATIONS
// =============================================================================

export const appointmentManageTokenRelations = relations(
  appointmentManageToken,
  ({ one }) => ({
    organization: one(organization, {
      fields: [appointmentManageToken.organizationId],
      references: [organization.id],
    }),
    appointment: one(appointment, {
      fields: [appointmentManageToken.appointmentId],
      references: [appointment.id],
    }),
  })
);

// =============================================================================
// TYPES
// =============================================================================

export type AppointmentManageToken = typeof appointmentManageToken.$inferSelect;
export type NewAppointmentManageToken =
  typeof appointmentManageToken.$inferInsert;
