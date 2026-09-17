/**
 * Intake-form enums — SOURCE OF TRUTH.
 * Pure TypeScript — no Drizzle imports.
 *
 * These are the consultation / consent / medical-history forms a clinic sends a
 * patient before their first appointment. Deliberately a DIFFERENT vocabulary
 * from lead-form fields (which map to Meta's fixed lead-gen types): a clinic
 * intake form has free text, dropdowns, consent checkboxes, dates, and — the
 * one lead-gen forms never need — a signature.
 */

// ── Field types ─────────────────────────────────────────────────────────────

export const intakeFieldTypeLabels = {
  short_text: 'Short text',
  long_text: 'Paragraph',
  dropdown: 'Dropdown',
  // A single yes/no — the shape of a consent line ("I consent to treatment").
  checkbox: 'Checkbox',
  // Pick one of many (radio). `multi_select` is pick several.
  single_select: 'Single choice',
  multi_select: 'Multiple choice',
  date: 'Date',
  // Captures a drawn signature. The one field a consent form cannot do without,
  // and the reason a lead-form field set could never stand in for this.
  signature: 'Signature',
  // Not an input — a heading / block of guidance rendered between questions.
  section: 'Section heading',
} as const;

export const intakeFieldTypeValues = Object.keys(intakeFieldTypeLabels) as [
  keyof typeof intakeFieldTypeLabels,
  ...(keyof typeof intakeFieldTypeLabels)[],
];

export type IntakeFieldType = keyof typeof intakeFieldTypeLabels;

/** Field types that never hold an answer — validation/skip them on submit. */
export const intakeNonInputFieldTypes = ['section'] as const;

// ── Submission status ───────────────────────────────────────────────────────

export const intakeSubmissionStatusLabels = {
  // Sent to the patient, not yet filled in. A required form in this state is
  // what blocks a booking's confirmation.
  pending: 'Awaiting response',
  completed: 'Completed',
} as const;

export const intakeSubmissionStatusValues = Object.keys(
  intakeSubmissionStatusLabels
) as [
  keyof typeof intakeSubmissionStatusLabels,
  ...(keyof typeof intakeSubmissionStatusLabels)[],
];

export type IntakeSubmissionStatus = keyof typeof intakeSubmissionStatusLabels;

/**
 * What a form IS. One engine serves three jobs that were three table-stacks:
 * questions asked before a visit, a document the patient signs, and the
 * clinician's record of what happened.
 */
export const formKindLabels = {
  intake: 'Intake',
  consent: 'Consent',
  note: 'Clinical note',
} as const;

export const formKindValues = Object.keys(formKindLabels) as [
  keyof typeof formKindLabels,
  ...(keyof typeof formKindLabels)[],
];

export type FormKind = keyof typeof formKindLabels;
