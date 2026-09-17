import {
  type IntakeFieldType,
  intakeSubmissionStatusValues,
} from '@borradh-workspace/labels';
import { createId } from '@paralleldrive/cuid2';
import { relations } from 'drizzle-orm';
import {
  boolean,
  index,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
} from 'drizzle-orm/pg-core';
import { orgRlsPolicy } from '../rls-policy.js';
import { appointment } from './appointments.js';
import { lead } from './leads.js';
import { organizationService } from './organization-service.js';
import { organization } from './organization.js';
import { user } from './user.js';

// Re-export label values/types for consumers
export {
  intakeFieldTypeLabels,
  intakeFieldTypeValues,
  intakeSubmissionStatusLabels,
  intakeSubmissionStatusValues,
} from '@borradh-workspace/labels';
export type {
  IntakeFieldType,
  IntakeSubmissionStatus,
} from '@borradh-workspace/labels';

export const intakeSubmissionStatusEnum = pgEnum(
  'intake_submission_status',
  intakeSubmissionStatusValues
);

// ── jsonb shapes ─────────────────────────────────────────────────────────────

/**
 * One question in an intake form. The `id` is a STABLE key: answers are keyed by
 * it, so a submission survives the form being reordered or relabelled later.
 * Never reuse an id for a different question.
 */
export interface IntakeFormField {
  id: string;
  type: IntakeFieldType;
  label: string;
  required?: boolean;
  /** For dropdown / single_select / multi_select. */
  options?: string[];
  helpText?: string;
}

/**
 * A single answer. The shape follows the field type:
 *   short_text/long_text/dropdown/single_select/date → string
 *   multi_select                                      → string[]
 *   checkbox                                          → boolean
 *   signature                                         → { dataUrl, signedAt }
 * Validated against the form definition on submit; stored loosely so a form can
 * evolve without a data migration.
 */
export type IntakeAnswer =
  | string
  | string[]
  | boolean
  | { dataUrl: string; signedAt: string };

// ── Tables ───────────────────────────────────────────────────────────────────

/**
 * IntakeForm — a consultation / consent / medical-history form definition.
 *
 * The questions live in `fields` (jsonb) rather than a child table because a
 * form is always read and written whole — there is no query that wants one
 * question — and keeping them inline means editing a form is a single-row write
 * with no ordering table to keep in sync.
 */
export const intakeForm = pgTable(
  'intake_form',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => createId()),

    organizationId: text('organization_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),

    name: text('name').notNull(),
    description: text('description'),

    fields: jsonb('fields').$type<IntakeFormField[]>().notNull().default([]),

    // Hide without deleting — a consent form that's been retired must stop being
    // sent while the submissions made against it stay readable on client files.
    isActive: boolean('is_active').notNull().default(true),

    createdById: text('created_by_id').references(() => user.id, {
      onDelete: 'set null',
    }),

    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at')
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
    deletedAt: timestamp('deleted_at'),
  },
  (table) => [
    index('idx_intake_form_organization_id').on(table.organizationId),
    unique('uq_intake_form_org_name').on(table.organizationId, table.name),
  ]
);

/**
 * OrganizationServiceIntakeForm — "booking this service needs this form".
 *
 * `blocksBooking` is the difference between the spec's two requirements:
 *   true  → "required forms block booking confirmation until completed": the
 *           appointment cannot be confirmed while a submission is outstanding.
 *   false → "auto-send before the first appointment": the form is sent, but its
 *           absence never holds up the booking (a nice-to-have questionnaire).
 *
 * A service with no rows here sends no forms and is unaffected — same
 * adoptability rule as rooms: turn intake on for one service without touching
 * the rest.
 */
export const organizationServiceIntakeForm = pgTable(
  'organization_service_intake_form',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => createId()),

    organizationId: text('organization_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),

    serviceId: text('service_id')
      .notNull()
      .references(() => organizationService.id, { onDelete: 'cascade' }),

    intakeFormId: text('intake_form_id')
      .notNull()
      .references(() => intakeForm.id, { onDelete: 'cascade' }),

    blocksBooking: boolean('blocks_booking').notNull().default(false),

    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [
    index('idx_org_service_intake_form_service_id').on(table.serviceId),
    index('idx_org_service_intake_form_form_id').on(table.intakeFormId),
    unique('uq_org_service_intake_form').on(
      table.serviceId,
      table.intakeFormId
    ),
  ]
);

/**
 * IntakeSubmission — one instance of a form sent to a patient, filled or not.
 *
 * Carries its OWN access capability (`tokenHash`), the same bearer-link pattern
 * as `appointment_manage_token`: the raw token is emailed/texted to the patient
 * and never stored, so the patient fills the form with no account and a DB dump
 * yields no working links.
 *
 * `fieldsSnapshot` freezes the questions AS ASKED. A consent form is a legal
 * record — "what did the patient actually agree to?" must be answerable even
 * after the form template is edited, so the submission does not trust the live
 * `intakeForm.fields` to still match.
 */
export const intakeSubmission = pgTable(
  'intake_submission',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => createId()),

    organizationId: text('organization_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),

    intakeFormId: text('intake_form_id')
      .notNull()
      .references(() => intakeForm.id, { onDelete: 'cascade' }),

    // Whose file this lands on. This is the "saved to client profile" link.
    leadId: text('lead_id')
      .notNull()
      .references(() => lead.id, { onDelete: 'cascade' }),

    // The booking that triggered the send, when there is one. Nullable: a clinic
    // can send a form to a client with no appointment on the books.
    // `set null` — deleting the appointment must not erase a signed consent.
    appointmentId: text('appointment_id').references(() => appointment.id, {
      onDelete: 'set null',
    }),

    status: intakeSubmissionStatusEnum('status').notNull().default('pending'),

    // SHA-256 of the patient's fill-in link. Unique so a lookup is one indexed
    // probe. Nullable: a form the clinic fills in on the patient's behalf at the
    // desk never needs a link.
    tokenHash: text('token_hash').unique(),

    // The questions as asked (see note above). Empty until first send.
    fieldsSnapshot: jsonb('fields_snapshot')
      .$type<IntakeFormField[]>()
      .notNull()
      .default([]),

    // fieldId → answer. Empty until submitted.
    answers: jsonb('answers')
      .$type<Record<string, IntakeAnswer>>()
      .notNull()
      .default({}),

    sentAt: timestamp('sent_at', { withTimezone: true }),
    completedAt: timestamp('completed_at', { withTimezone: true }),

    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at')
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    index('idx_intake_submission_org_id').on(table.organizationId),
    index('idx_intake_submission_lead_id').on(table.leadId),
    index('idx_intake_submission_appointment_id').on(table.appointmentId),
    // Outstanding-required-forms check for an appointment leads with these two.
    index('idx_intake_submission_appt_status').on(
      table.appointmentId,
      table.status
    ),
  ]
);

// ── RLS ──────────────────────────────────────────────────────────────────────

export const intakeFormRlsPolicy = orgRlsPolicy(intakeForm);
export const organizationServiceIntakeFormRlsPolicy = orgRlsPolicy(
  organizationServiceIntakeForm
);
export const intakeSubmissionRlsPolicy = orgRlsPolicy(intakeSubmission);

// ── Relations ────────────────────────────────────────────────────────────────

export const intakeFormRelations = relations(intakeForm, ({ one, many }) => ({
  organization: one(organization, {
    fields: [intakeForm.organizationId],
    references: [organization.id],
  }),
  createdBy: one(user, {
    fields: [intakeForm.createdById],
    references: [user.id],
  }),
  serviceLinks: many(organizationServiceIntakeForm),
  submissions: many(intakeSubmission),
}));

export const organizationServiceIntakeFormRelations = relations(
  organizationServiceIntakeForm,
  ({ one }) => ({
    organization: one(organization, {
      fields: [organizationServiceIntakeForm.organizationId],
      references: [organization.id],
    }),
    service: one(organizationService, {
      fields: [organizationServiceIntakeForm.serviceId],
      references: [organizationService.id],
    }),
    intakeForm: one(intakeForm, {
      fields: [organizationServiceIntakeForm.intakeFormId],
      references: [intakeForm.id],
    }),
  })
);

export const intakeSubmissionRelations = relations(
  intakeSubmission,
  ({ one }) => ({
    organization: one(organization, {
      fields: [intakeSubmission.organizationId],
      references: [organization.id],
    }),
    intakeForm: one(intakeForm, {
      fields: [intakeSubmission.intakeFormId],
      references: [intakeForm.id],
    }),
    lead: one(lead, {
      fields: [intakeSubmission.leadId],
      references: [lead.id],
    }),
    appointment: one(appointment, {
      fields: [intakeSubmission.appointmentId],
      references: [appointment.id],
    }),
  })
);

// ── Types ────────────────────────────────────────────────────────────────────

export type IntakeForm = typeof intakeForm.$inferSelect;
export type NewIntakeForm = typeof intakeForm.$inferInsert;
export type OrganizationServiceIntakeForm =
  typeof organizationServiceIntakeForm.$inferSelect;
export type NewOrganizationServiceIntakeForm =
  typeof organizationServiceIntakeForm.$inferInsert;
export type IntakeSubmission = typeof intakeSubmission.$inferSelect;
export type NewIntakeSubmission = typeof intakeSubmission.$inferInsert;
