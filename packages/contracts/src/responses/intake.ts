/**
 * intake-form response PROJECTIONS — hand-composed from generated atoms.
 *
 * Covers the intake-forms surface: the form definition (list + entity), the
 * PUBLIC fill-in view a patient sees behind a token, the submission row shown
 * on a client profile, and the booking-gate "outstanding" shape.
 *
 * The generator types the two jsonb columns — `intakeForm.fields` and
 * `intakeSubmission.fieldsSnapshot` / `.answers` — as `z.unknown()` (it can't
 * see through `jsonb().$type<...>()`), so those are hand-modeled here to match
 * the DB shapes in packages/database/src/schema/intake-form.ts. Pure Zod.
 *
 * Follows the proof pattern in ./leads.ts. Each response exports a schema plus
 * its `z.infer` type.
 */
import {
  intakeFieldTypeValues,
  intakeSubmissionStatusValues,
} from '@borradh-workspace/labels';
import { z } from 'zod';
import {
  intakeFormAtomSchema,
  intakeSubmissionAtomSchema,
} from '../generated/index.js';

// ============================================================================
// FIELD + ANSWER SHAPES (jsonb, hand-modeled)
// ============================================================================

/** One question in a form. Matches `IntakeFormField` in the DB schema. */
export const intakeFormFieldSchema = z.object({
  id: z.string(),
  type: z.enum(intakeFieldTypeValues),
  label: z.string(),
  required: z.boolean().optional(),
  options: z.array(z.string()).optional(),
  helpText: z.string().optional(),
});
export type IntakeFormField = z.infer<typeof intakeFormFieldSchema>;

/** A drawn signature answer. */
export const intakeSignatureAnswerSchema = z.object({
  dataUrl: z.string(),
  signedAt: z.string(),
});

/** A single answer. Shape follows the field type (see `IntakeAnswer`). */
export const intakeAnswerSchema = z.union([
  z.string(),
  z.array(z.string()),
  z.boolean(),
  intakeSignatureAnswerSchema,
]);
export type IntakeAnswer = z.infer<typeof intakeAnswerSchema>;

// ============================================================================
// INTAKE FORM (dashboard)
// ============================================================================

/** An intake form definition on the wire (jsonb `fields` typed). */
export const intakeFormSchema = intakeFormAtomSchema.extend({
  fields: z.array(intakeFormFieldSchema),
});
export type IntakeForm = z.infer<typeof intakeFormSchema>;

/** `GET /intake-forms` — the `{ items }` wrapper. */
export const listIntakeFormsResponseSchema = z.object({
  items: z.array(intakeFormSchema),
});
export type ListIntakeFormsResponse = z.infer<
  typeof listIntakeFormsResponseSchema
>;

/** `POST /intake-forms/seed-templates`. */
export const seedIntakeTemplatesResponseSchema = z.object({
  created: z.array(z.string()),
  skipped: z.array(z.string()),
});
export type SeedIntakeTemplatesResponse = z.infer<
  typeof seedIntakeTemplatesResponseSchema
>;

/** `PUT /intake-forms/services/:serviceId/forms`. */
export const setServiceIntakeFormsResponseSchema = z.object({
  serviceId: z.string(),
  count: z.number(),
});
export type SetServiceIntakeFormsResponse = z.infer<
  typeof setServiceIntakeFormsResponseSchema
>;

/**
 * `GET /intake-forms/services/:serviceId/forms` — the forms currently linked to
 * a service, so the attach dialog opens pre-populated.
 */
export const getServiceIntakeFormsResponseSchema = z.object({
  forms: z.array(
    z.object({
      intakeFormId: z.string(),
      intakeFormName: z.string(),
      blocksBooking: z.boolean(),
    })
  ),
});
export type GetServiceIntakeFormsResponse = z.infer<
  typeof getServiceIntakeFormsResponseSchema
>;

/** `POST /intake-forms/issue` — mints a send link, returns the RAW token. */
export const issueIntakeSubmissionResponseSchema = z.object({
  submissionId: z.string(),
  token: z.string(),
});
export type IssueIntakeSubmissionResponse = z.infer<
  typeof issueIntakeSubmissionResponseSchema
>;

// ============================================================================
// INTAKE SUBMISSION (client profile)
// ============================================================================

/**
 * A submission row on a client profile — the snapshot `fieldsSnapshot` and
 * `answers` jsonb are typed. `tokenHash` is deliberately NOT projected here so
 * a client-profile read never carries the credential hash to the browser.
 */
export const intakeSubmissionSchema = intakeSubmissionAtomSchema
  .omit({ tokenHash: true })
  .extend({
    fieldsSnapshot: z.array(intakeFormFieldSchema),
    answers: z.record(z.string(), intakeAnswerSchema),
  });
export type IntakeSubmission = z.infer<typeof intakeSubmissionSchema>;

/** `GET /intake-forms/submissions/lead/:leadId` — the `{ items }` wrapper. */
export const listLeadSubmissionsResponseSchema = z.object({
  items: z.array(intakeSubmissionSchema),
});
export type ListLeadSubmissionsResponse = z.infer<
  typeof listLeadSubmissionsResponseSchema
>;

// ============================================================================
// OUTSTANDING (booking gate)
// ============================================================================

/** `GET /intake-forms/outstanding/:appointmentId`. */
export const outstandingIntakeSchema = z.object({
  blockingCount: z.number(),
  pendingCount: z.number(),
  isBlocked: z.boolean(),
});
export type OutstandingIntake = z.infer<typeof outstandingIntakeSchema>;

// ============================================================================
// PUBLIC INTAKE VIEW (the form to fill)
// ============================================================================

/**
 * `GET /public/intake/:organizationSlug/:token` — the form a patient fills in.
 * `fields` come from the submission SNAPSHOT (the questions as asked); `answers`
 * are the prior answers when revisiting a completed form (read-only review).
 */
export const publicIntakeViewSchema = z.object({
  submissionId: z.string(),
  formName: z.string(),
  formDescription: z.string().nullable(),
  fields: z.array(intakeFormFieldSchema),
  status: z.enum(intakeSubmissionStatusValues),
  answers: z.record(z.string(), intakeAnswerSchema),
  organization: z.object({
    name: z.string(),
    slug: z.string(),
    logo: z.string().nullable(),
  }),
});
export type PublicIntakeView = z.infer<typeof publicIntakeViewSchema>;

/** `POST /public/intake/:organizationSlug/:token/submit`. */
export const submitIntakeFormResponseSchema = z.object({
  submissionId: z.string(),
});
export type SubmitIntakeFormResponse = z.infer<
  typeof submitIntakeFormResponseSchema
>;
