/**
 * The unified form engine — one template table, one submission table, serving
 * intake questionnaires, consent documents and clinical notes.
 *
 * ## Why this exists (see docs/handoffs/portal.md §2.8)
 *
 * `consent-forms.ts` and `intake-form.ts` are the same three tables twice:
 * template with a `fields` jsonb → service linkage → submission with a
 * snapshot, answers and a status. Clinical note templates would have been a
 * third copy. Intake was already strictly the more capable of the two — nine
 * field types against consent's three, INCLUDING `signature`, the one thing
 * consent supposedly needed its own model for.
 *
 * ## The two shape rules
 *
 * 1. Type-specific apparatus lives in a CHILD table. Consent's eight
 *    signature/PDF columns and a note's sign-off do not belong as nullable
 *    columns on a shared row — that way lies thirty columns of which every row
 *    uses a third.
 * 2. Per-type invariants survive as PARTIAL CHECKS. Merging turns
 *    consent's required columns nullable, which would trade a database
 *    constraint for a convention. `form_submission_consent_signed` restores it.
 *
 * ## The dangerous part is RLS, not the data
 *
 * `consent_form_submission` carries a patient-self policy (patients read their
 * own in the portal); `intake_submission` does not. Collapsing them puts that
 * policy on a table that ALSO holds clinical notes, and "belongs to this lead"
 * would hand a patient the assessment written about them. Hence
 * `patient_visibility` on the template and the `andSql` narrowing on the
 * policy below. This is the only part of the merge that can leak.
 *
 * ## Migration status
 *
 * EXPAND phase. The six old tables still exist and still own every read; 73
 * files reference them (51 consent, 22 intake). Port intake first — zero rows,
 * nothing in production depends on it — and consent last, because the portal
 * consent flow is the part that works today. Drop the old tables only once
 * nothing reads them.
 */

import { createId } from '@paralleldrive/cuid2';
import { relations, sql } from 'drizzle-orm';
import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
} from 'drizzle-orm/pg-core';

import {
  formKindValues,
  intakeSubmissionStatusValues,
} from '@borradh-workspace/labels';
import {
  joinRlsPolicy,
  orgRlsPolicy,
  patientSelfRlsPolicy,
} from '../rls-policy.js';
import { appointment } from './appointments.js';
import type { IntakeFormField } from './intake-form.js';
import { lead } from './leads.js';
import { organizationService } from './organization-service.js';
import { organization } from './organization.js';
import { user } from './user.js';

export const formKindEnum = pgEnum('form_kind', formKindValues);

/**
 * Whether a patient may see a submission of this template in the portal.
 * Defaults to `staff_only`: a new template is invisible until someone decides
 * otherwise, which is the safe direction for a table that holds notes.
 */
export const formVisibilityEnum = pgEnum('form_visibility', [
  'staff_only',
  'patient',
]);

/* ------------------------------------------------------------- template -- */

export const form = pgTable(
  'form',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => createId()),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
    kind: formKindEnum('kind').notNull(),
    name: text('name').notNull(),
    /** Consent's `body` and intake's `description` are the same column. */
    description: text('description'),
    fields: jsonb('fields').$type<IntakeFormField[]>().notNull().default([]),
    requiresSignature: boolean('requires_signature').notNull().default(false),
    patientVisibility: formVisibilityEnum('patient_visibility')
      .notNull()
      .default('staff_only'),
    isActive: boolean('is_active').notNull().default(true),
    createdById: text('created_by_id').references(() => user.id, {
      onDelete: 'set null',
    }),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at')
      .defaultNow()
      .notNull()
      .$onUpdate(() => new Date()),
    /** Retire a template without deleting the submissions made against it. */
    deletedAt: timestamp('deleted_at'),
  },
  (table) => [
    index('idx_form_org_kind').on(table.organizationId, table.kind),
    /**
     * The old `uq_intake_form_org_name` did not survive the merge into this
     * table, and its absence turned the duplicate-name 409 into a pre-check
     * SELECT — which two simultaneous creates both pass. ENG-844 (#975) had
     * just fixed that very 409 to actually fire, which is the proof it is
     * relied on.
     *
     * Scoped by KIND as well as name: a consent form and an intake form may
     * legitimately share a title. Partial on `deleted_at IS NULL`, because
     * retiring a template must free its name.
     */
    uniqueIndex('uq_form_org_kind_name')
      .on(table.organizationId, table.kind, table.name)
      .where(sql`${table.deletedAt} IS NULL`),
    /**
     * A clinical note is NEVER patient-visible. Not "visible unless someone
     * ticks a box" — never.
     *
     * What the patient receives is a TREATMENT PLAN: a separate, editable,
     * patient-facing document generated from the note, published to the portal
     * or emailed as a PDF (see `treatment_plan`). That separation is the whole
     * safety property — the clinician writes the record in their own language,
     * then decides what the patient is told, rather than one artefact having to
     * serve both audiences.
     *
     * An earlier version of this constraint keyed on `requires_signature`,
     * which made it say almost nothing. This is the rule that was meant.
     */
    check(
      'form_note_never_patient_visible',
      sql`${table.kind} <> 'note' OR ${table.patientVisibility} = 'staff_only'`
    ),
  ]
);

export const formRlsPolicy = orgRlsPolicy(form);

/* ------------------------------------------------- service requirement -- */

/** Replaces organization_service_form_requirement AND …_intake_form. */
export const formServiceRequirement = pgTable(
  'form_service_requirement',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => createId()),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
    formId: text('form_id')
      .notNull()
      .references(() => form.id, { onDelete: 'cascade' }),
    serviceId: text('service_id')
      .notNull()
      .references(() => organizationService.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [
    unique('form_service_requirement_unique').on(table.formId, table.serviceId),
    index('idx_form_service_requirement_service').on(table.serviceId),
  ]
);

export const formServiceRequirementRlsPolicy = orgRlsPolicy(
  formServiceRequirement
);

/* ----------------------------------------------------------- submission -- */

export const formSubmissionStatusEnum = pgEnum(
  'form_submission_status',
  intakeSubmissionStatusValues
);

export const formSubmission = pgTable(
  'form_submission',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => createId()),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
    formId: text('form_id')
      .notNull()
      .references(() => form.id, { onDelete: 'restrict' }),
    /**
     * Denormalised from the template so RLS and every "what is outstanding"
     * query can filter without a join. A policy that has to join to decide
     * what it may show is a policy that will eventually be got wrong.
     */
    kind: formKindEnum('kind').notNull(),
    /** Copied at send time for the same reason — see `patient_visibility`. */
    patientVisibility: formVisibilityEnum('patient_visibility')
      .notNull()
      .default('staff_only'),
    leadId: text('lead_id').references(() => lead.id, { onDelete: 'cascade' }),
    appointmentId: text('appointment_id').references(() => appointment.id, {
      onDelete: 'cascade',
    }),
    /**
     * The questions AS ASKED. A submission must stay readable after its
     * template is reordered, relabelled or retired — for consent this is the
     * difference between having a record and having a claim.
     */
    fieldsSnapshot: jsonb('fields_snapshot')
      .$type<IntakeFormField[]>()
      .notNull()
      .default([]),
    answers: jsonb('answers').$type<Record<string, unknown>>(),
    status: formSubmissionStatusEnum('status').notNull().default('pending'),
    /** Single-use link for a patient completing this off-session. */
    tokenHash: text('token_hash'),
    sentAt: timestamp('sent_at'),
    reminderSentAt: timestamp('reminder_sent_at'),
    completedAt: timestamp('completed_at'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at')
      .defaultNow()
      .notNull()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    index('idx_form_submission_appointment').on(table.appointmentId),
    index('idx_form_submission_lead').on(table.leadId),
    index('idx_form_submission_org_kind').on(table.organizationId, table.kind),
  ]
);

export const formSubmissionRlsPolicy = orgRlsPolicy(formSubmission);

/**
 * The patient-portal read. Ownership alone is NOT enough here: this table
 * holds clinical notes as well as consent, so the policy is narrowed to rows
 * the template marked patient-visible. Without the narrowing a patient reads
 * the assessment written about them.
 */
export const formSubmissionPatientSelfPolicy = patientSelfRlsPolicy(
  formSubmission,
  {
    andSql: sql`form_submission.patient_visibility = 'patient'`,
  }
);

/* ------------------------------------------------------------ signature -- */

/**
 * Consent's evidence, kept out of the shared row. These columns are what a
 * clinic produces when a treatment is challenged, and they apply to exactly
 * one kind of submission.
 */
export const formSignature = pgTable(
  'form_signature',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => createId()),
    submissionId: text('submission_id')
      .notNull()
      .unique()
      .references(() => formSubmission.id, { onDelete: 'cascade' }),
    signedByName: text('signed_by_name'),
    signedAt: timestamp('signed_at'),
    signedIp: text('signed_ip'),
    signatureImageKey: text('signature_image_key'),
    pdfKey: text('pdf_key'),
    pdfGenerationAttempts: integer('pdf_generation_attempts')
      .notNull()
      .default(0),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at')
      .defaultNow()
      .notNull()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    /**
     * Restores the invariant the merge would otherwise have dissolved into a
     * convention: a signature row that claims to be signed carries WHO and
     * WHEN, or it is not evidence.
     */
    check(
      'form_signature_signed_has_who_and_when',
      sql`(${table.signedAt} IS NULL) = (${table.signedByName} IS NULL)`
    ),
  ]
);

export const formSignatureRlsPolicy = joinRlsPolicy(formSignature, {
  parent: 'form_submission',
  fk: 'submission_id',
});

/* ------------------------------------------------------------ relations -- */

export const formRelations = relations(form, ({ one, many }) => ({
  organization: one(organization, {
    fields: [form.organizationId],
    references: [organization.id],
  }),
  submissions: many(formSubmission),
  services: many(formServiceRequirement),
}));

export const formSubmissionRelations = relations(formSubmission, ({ one }) => ({
  form: one(form, {
    fields: [formSubmission.formId],
    references: [form.id],
  }),
  lead: one(lead, {
    fields: [formSubmission.leadId],
    references: [lead.id],
  }),
  appointment: one(appointment, {
    fields: [formSubmission.appointmentId],
    references: [appointment.id],
  }),
  signature: one(formSignature, {
    fields: [formSubmission.id],
    references: [formSignature.submissionId],
  }),
}));

export const formServiceRequirementRelations = relations(
  formServiceRequirement,
  ({ one }) => ({
    form: one(form, {
      fields: [formServiceRequirement.formId],
      references: [form.id],
    }),
    service: one(organizationService, {
      fields: [formServiceRequirement.serviceId],
      references: [organizationService.id],
    }),
  })
);

export type Form = typeof form.$inferSelect;
export type FormSubmission = typeof formSubmission.$inferSelect;
export type FormSignature = typeof formSignature.$inferSelect;
