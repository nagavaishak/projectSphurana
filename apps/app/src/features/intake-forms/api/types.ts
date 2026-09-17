/**
 * Intake-forms frontend types.
 *
 * Response types come from `@borradh-workspace/contracts` (the wire contract);
 * input types are hand-declared here (server-scoped fields like organizationId
 * are supplied by the API from the session, so they are absent from the body).
 */
import type { IntakeFieldType } from '@borradh-workspace/labels';

export type {
  IntakeForm,
  IntakeFormField,
  IntakeAnswer,
  IntakeSubmission,
  ListIntakeFormsResponse,
  ListLeadSubmissionsResponse,
  OutstandingIntake,
  PublicIntakeView,
  SeedIntakeTemplatesResponse,
  SetServiceIntakeFormsResponse,
  IssueIntakeSubmissionResponse,
  SubmitIntakeFormResponse,
} from '@borradh-workspace/contracts';

/** A form field as edited in the builder (same shape as the wire field). */
export interface IntakeFormFieldInput {
  id: string;
  type: IntakeFieldType;
  label: string;
  required?: boolean;
  options?: string[];
  helpText?: string;
}

export interface CreateIntakeFormInput {
  name: string;
  description?: string;
  fields: IntakeFormFieldInput[];
}

export interface UpdateIntakeFormInput {
  name?: string;
  description?: string | null;
  fields?: IntakeFormFieldInput[];
  isActive?: boolean;
}

export interface SeedIntakeTemplatesInput {
  keys?: string[];
}

export interface ServiceIntakeFormLink {
  intakeFormId: string;
  blocksBooking: boolean;
}

export interface SetServiceIntakeFormsInput {
  forms: ServiceIntakeFormLink[];
}

export interface IssueIntakeSubmissionInput {
  intakeFormId: string;
  leadId: string;
  appointmentId?: string;
}
