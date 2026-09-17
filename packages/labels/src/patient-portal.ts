/**
 * Patient portal labels (ENG-647).
 *
 * "Patient" here means the CLINIC'S customer (the person who books), not the
 * clinic org itself. Patient accounts hang 1:1 off the `lead` row — see
 * docs/plans/eng-647-customer-portal.md.
 */

// NOTE: patient sign-in tokens (OTP codes + magic links) are now owned by the
// patient Better Auth instance (`@borradh-workspace/auth/patient`) in its
// `patient_verification` table — the bespoke `patient_account_token` enum and
// its purpose labels were removed with that migration (ENG-647).

/** Field types a clinic can add to a consent-form template. */
export const consentFormFieldTypeLabels = {
  text: 'Short text',
  checkbox: 'Checkbox',
  date: 'Date',
} as const;

export const consentFormFieldTypeValues = Object.keys(
  consentFormFieldTypeLabels
) as [
  keyof typeof consentFormFieldTypeLabels,
  ...(keyof typeof consentFormFieldTypeLabels)[],
];

export type ConsentFormFieldType = keyof typeof consentFormFieldTypeLabels;

/** Lifecycle of one patient's consent-form submission for one appointment. */
export const consentFormSubmissionStatusLabels = {
  pending: 'Pending',
  completed: 'Completed',
} as const;

export const consentFormSubmissionStatusValues = Object.keys(
  consentFormSubmissionStatusLabels
) as [
  keyof typeof consentFormSubmissionStatusLabels,
  ...(keyof typeof consentFormSubmissionStatusLabels)[],
];

export type ConsentFormSubmissionStatus =
  keyof typeof consentFormSubmissionStatusLabels;

/** Who uploaded a patient document. */
export const patientDocumentUploadedByLabels = {
  patient: 'Patient',
  staff: 'Staff',
} as const;

export const patientDocumentUploadedByValues = Object.keys(
  patientDocumentUploadedByLabels
) as [
  keyof typeof patientDocumentUploadedByLabels,
  ...(keyof typeof patientDocumentUploadedByLabels)[],
];

export type PatientDocumentUploadedBy =
  keyof typeof patientDocumentUploadedByLabels;
