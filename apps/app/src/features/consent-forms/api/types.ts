/**
 * Consent-forms (staff/dashboard) API types — ENG-647 Phases 2–3.
 *
 * These mirror the backend contract being built in parallel
 * (apps/api/src/consent-form-templates/); shapes are intentionally minimal so
 * drift is easy to absorb. Enum types derive from @borradh-workspace/labels
 * (single source of truth).
 */

import type {
  ConsentFormFieldType,
  ConsentFormSubmissionStatus,
} from '@borradh-workspace/labels';

/** One extra field a clinic added to a template (rendered in order). */
export interface ConsentFormTemplateField {
  type: ConsentFormFieldType;
  label: string;
}

/** Response item of GET consent-form-templates. */
export interface ConsentFormTemplate {
  id: string;
  title: string;
  body: string;
  fields: ConsentFormTemplateField[];
  requiresSignature: boolean;
  isActive: boolean;
  createdAt: string;
}

export interface ConsentFormTemplateListResponse {
  items: ConsentFormTemplate[];
}

export interface CreateConsentFormTemplateInput {
  title: string;
  body: string;
  fields: ConsentFormTemplateField[];
  requiresSignature: boolean;
}

export type UpdateConsentFormTemplateInput = CreateConsentFormTemplateInput;

/** Item of GET .../organization-services-form-requirements/:serviceId. */
export interface ServiceFormRequirement {
  templateId: string;
  title: string;
}

export interface ServiceFormRequirementsResponse {
  items: ServiceFormRequirement[];
}

/** Item of GET consent-form-templates/submissions?appointmentId=X. */
export interface AppointmentFormSubmission {
  id: string;
  title: string;
  status: ConsentFormSubmissionStatus;
  signedByName: string | null;
  signedAt: string | null;
}

export interface AppointmentFormSubmissionsResponse {
  items: AppointmentFormSubmission[];
}
