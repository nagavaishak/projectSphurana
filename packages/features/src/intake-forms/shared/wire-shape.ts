import type {
  Form,
  FormSubmission,
  IntakeAnswer,
  IntakeFormField,
} from '@borradh-workspace/database';

/**
 * Intake now STORES itself in the unified form engine (`form` /
 * `form_submission`, `kind = 'intake'`) but still SPEAKS the intake wire
 * language — see docs/handoffs/portal.md §2.8. This module is the seam between
 * the two.
 *
 * The HTTP contract is deliberately unchanged by the storage swap: a response
 * field named `intakeFormId` stays `intakeFormId` even though the column behind
 * it is now `form_submission.form_id`, and the unified row's extra columns
 * (`kind`, `requires_signature`, `patient_visibility`, `reminder_sent_at`) are
 * projected AWAY rather than leaking into a response that never carried them.
 *
 * When consent and notes have also moved and the old tables are dropped
 * (the CONTRACT phase), this is the file to delete — and the wire names to
 * rename in one deliberate, versioned step.
 */

/**
 * `form_submission.answers` is `jsonb $type<Record<string, unknown>>` and
 * nullable; `intake_submission.answers` was `$type<Record<string, IntakeAnswer>>`
 * and NOT NULL. Every write on the intake path goes through
 * `validateIntakeAnswers` against the field snapshot, so the narrowing is
 * enforced where it can be — at submit — not by the column type.
 */
export const toIntakeAnswers = (
  answers: Record<string, unknown> | null
): Record<string, IntakeAnswer> =>
  (answers ?? {}) as Record<string, IntakeAnswer>;

/** The intake-form row as the API has always returned it. */
export interface IntakeFormRow {
  id: string;
  organizationId: string;
  name: string;
  description: string | null;
  fields: IntakeFormField[];
  isActive: boolean;
  createdById: string | null;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
}

export const toIntakeFormRow = (row: Form): IntakeFormRow => ({
  id: row.id,
  organizationId: row.organizationId,
  name: row.name,
  description: row.description,
  fields: row.fields,
  isActive: row.isActive,
  createdById: row.createdById,
  createdAt: row.createdAt,
  updatedAt: row.updatedAt,
  deletedAt: row.deletedAt,
});

/** The intake-submission row as the API has always returned it. */
export interface IntakeSubmissionRow {
  id: string;
  organizationId: string;
  /** `form_submission.form_id` under its long-standing wire name. */
  intakeFormId: string;
  leadId: string;
  appointmentId: string | null;
  status: FormSubmission['status'];
  tokenHash: string | null;
  fieldsSnapshot: IntakeFormField[];
  answers: Record<string, IntakeAnswer>;
  sentAt: Date | null;
  completedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export const toIntakeSubmissionRow = (
  row: FormSubmission
): IntakeSubmissionRow => ({
  id: row.id,
  organizationId: row.organizationId,
  intakeFormId: row.formId,
  // `form_submission.lead_id` is nullable (a note is written about nobody in
  // particular); every intake submission is minted against a lead, and the one
  // read that returns these is already filtered by lead id.
  leadId: row.leadId ?? '',
  appointmentId: row.appointmentId,
  status: row.status,
  tokenHash: row.tokenHash,
  fieldsSnapshot: row.fieldsSnapshot,
  // `answers` is nullable on the unified table; intake has always presented an
  // unanswered form as `{}`.
  answers: toIntakeAnswers(row.answers),
  sentAt: row.sentAt,
  completedAt: row.completedAt,
  createdAt: row.createdAt,
  updatedAt: row.updatedAt,
});
