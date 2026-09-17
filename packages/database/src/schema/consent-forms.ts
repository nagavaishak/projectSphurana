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
  unique,
} from 'drizzle-orm/pg-core';
import { appointment } from './appointments.js';
import { lead } from './leads.js';
import { organizationService } from './organization-service.js';
import { organization } from './organization.js';

import {
  joinRlsPolicy,
  orgRlsPolicy,
  patientSelfRlsPolicy,
} from '../rls-policy.js';

import {
  type ConsentFormFieldType,
  consentFormFieldTypeLabels,
  consentFormFieldTypeValues,
  consentFormSubmissionStatusLabels,
  consentFormSubmissionStatusValues,
} from '@borradh-workspace/labels';

// Re-export labels and types for consumers
export {
  consentFormFieldTypeLabels,
  consentFormFieldTypeValues,
  consentFormSubmissionStatusLabels,
  consentFormSubmissionStatusValues,
};
export type {
  ConsentFormFieldType,
  ConsentFormSubmissionStatus,
} from '@borradh-workspace/labels';

export const consentFormSubmissionStatusEnum = pgEnum(
  'consent_form_submission_status',
  consentFormSubmissionStatusValues
);

/** One extra field a clinic adds to a template (rendered in order). */
export interface ConsentFormField {
  type: ConsentFormFieldType;
  label: string;
}

/**
 * Consent-form templates (ENG-647 Phase 2) — what a clinic can require a
 * patient to complete before a treatment. Org-scoped, staff-managed; patients
 * never read templates directly (they read their own submissions, which
 * embed a snapshot — see consentFormSubmission.templateSnapshot).
 */
export const consentFormTemplate = pgTable(
  'consent_form_template',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => createId()),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    /** Form body (markdown-ish rich text; {{patientName}} placeholder). */
    body: text('body').notNull(),
    fields: jsonb('fields').$type<ConsentFormField[]>().default([]).notNull(),
    requiresSignature: boolean('requires_signature').notNull().default(true),
    isActive: boolean('is_active').notNull().default(true),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at')
      .defaultNow()
      .notNull()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    index('idx_consent_form_template_org_id').on(table.organizationId),
  ]
);

export const consentFormTemplateRlsPolicy = orgRlsPolicy(consentFormTemplate);

/**
 * Which consent form(s) a service requires — many-to-many join, modeled on
 * assetService.
 */
export const organizationServiceFormRequirement = pgTable(
  'organization_service_form_requirement',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => createId()),
    serviceId: text('service_id')
      .notNull()
      .references(() => organizationService.id, { onDelete: 'cascade' }),
    templateId: text('template_id')
      .notNull()
      .references(() => consentFormTemplate.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [
    unique('uq_service_form_requirement').on(table.serviceId, table.templateId),
    index('idx_service_form_requirement_service_id').on(table.serviceId),
  ]
);

export const organizationServiceFormRequirementRlsPolicy = joinRlsPolicy(
  organizationServiceFormRequirement,
  { parent: 'consent_form_template', fk: 'template_id' }
);

/**
 * One patient's consent-form instance for one appointment (ENG-647 Phase 3).
 * Created at booking time from the service's required templates; completed
 * (and optionally signed) by the patient in the portal.
 *
 * `templateSnapshot` freezes title/body/fields at send time — a clinic
 * editing a template later must not silently change what a patient already
 * signed.
 */
export const consentFormSubmission = pgTable(
  'consent_form_submission',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => createId()),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
    // RESTRICT, not cascade. A completed row is an executed legal instrument:
    // it carries signed_at, signed_ip, the signature image key and the PDF
    // key. Cascading meant staff tidying a mis-booked slot silently destroyed
    // the patient's signed consent for that treatment — no audit row, and
    // orphaned S3 objects. The hard-delete paths in deleteAppointment and
    // deleteLead purge PENDING submissions first, so an unsigned form never
    // blocks a delete; only a signed one does, as a CONFLICT.
    //
    // Note the asymmetry this fixes: templateId was already RESTRICT, so the
    // blank form was better protected than the executed signature.
    appointmentId: text('appointment_id')
      .notNull()
      .references(() => appointment.id, { onDelete: 'restrict' }),
    leadId: text('lead_id')
      .notNull()
      .references(() => lead.id, { onDelete: 'restrict' }),
    templateId: text('template_id')
      .notNull()
      .references(() => consentFormTemplate.id, { onDelete: 'restrict' }),
    templateSnapshot: jsonb('template_snapshot')
      .$type<{
        title: string;
        body: string;
        fields: ConsentFormField[];
        requiresSignature: boolean;
      }>()
      .notNull(),
    status: consentFormSubmissionStatusEnum('status')
      .notNull()
      .default('pending'),
    fieldData: jsonb('field_data')
      .$type<Record<string, string | boolean>>()
      .default({})
      .notNull(),
    signedByName: text('signed_by_name'),
    signedAt: timestamp('signed_at'),
    signedIp: text('signed_ip'),
    /** S3 key of the drawn-signature PNG (Portal v2 signing). */
    signatureImageKey: text('signature_image_key'),
    /** S3 key of the generated PDF; NULL = regenerate on demand at download. */
    pdfKey: text('pdf_key'),
    /**
     * How many times PDF generation has failed for this submission.
     *
     * Generation at sign time is fire-and-forget, and the download endpoint
     * regenerates whenever `pdf_key` is still null — so a submission whose
     * compose fails DETERMINISTICALLY (an oversized body, a pdf-lib throw, a
     * logo that times out) re-ran the whole compose on every download, from
     * both the patient and the staff endpoint, with no backoff and no record.
     * The only symptom was repeated 500s.
     *
     * Past a small number of attempts the download stops trying and returns a
     * typed error, which is both cheaper and finally observable. Reset to 0 on
     * success, so a transient failure never permanently condemns a form.
     */
    pdfGenerationAttempts: integer('pdf_generation_attempts')
      .notNull()
      .default(0),
    sentAt: timestamp('sent_at'),
    reminderSentAt: timestamp('reminder_sent_at'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at')
      .defaultNow()
      .notNull()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    index('idx_consent_form_submission_org_id').on(table.organizationId),
    index('idx_consent_form_submission_appointment_id').on(table.appointmentId),
    index('idx_consent_form_submission_lead_id').on(table.leadId),
    // One submission per (appointment, template). The booking hook that creates
    // these is not naturally idempotent — a retried booking request, a
    // redelivered webhook or a future "resend forms" action would otherwise
    // hand the patient a second copy of the same form to sign and a second
    // email asking them to. The DB is the only place that can actually enforce
    // this against concurrent callers.
    unique('uq_consent_form_submission_appointment_template').on(
      table.appointmentId,
      table.templateId
    ),
  ]
);

export const consentFormSubmissionRlsPolicy = orgRlsPolicy(
  consentFormSubmission
);
/** Patients read their own submissions in the portal. */
export const consentFormSubmissionPatientSelfPolicy = patientSelfRlsPolicy(
  consentFormSubmission
);

// Types
export type ConsentFormTemplate = typeof consentFormTemplate.$inferSelect;
export type NewConsentFormTemplate = typeof consentFormTemplate.$inferInsert;
export type OrganizationServiceFormRequirement =
  typeof organizationServiceFormRequirement.$inferSelect;
export type ConsentFormSubmission = typeof consentFormSubmission.$inferSelect;
export type NewConsentFormSubmission =
  typeof consentFormSubmission.$inferInsert;
