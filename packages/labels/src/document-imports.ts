/**
 * Document import labels (ENG-784).
 *
 * A document import is a PDF/photo dropped into the bulk "Import Documents"
 * flow, staged until the matcher has decided which client (lead) it belongs
 * to. Once matched it becomes an ordinary `patient_document` in that client's
 * vault; the import row stays behind as the audit trail of how it got there.
 */

/** Lifecycle of one staged document. */
export const documentImportStatusLabels = {
  /** Presigned; the browser PUT has not been confirmed yet. */
  uploading: 'Uploading',
  /** Bytes are in S3, queued for the matcher. */
  pending: 'Queued',
  /** The matcher has claimed it. */
  processing: 'Reading',
  /** Attached to a client's vault (auto or manual). */
  matched: 'Matched',
  /** No confident match — a person must pick the client or discard. */
  needs_review: 'Needs review',
  /** The pipeline could not read or store the file. */
  failed: 'Failed',
  /** Staff chose not to keep it. */
  discarded: 'Discarded',
} as const;

export const documentImportStatusValues = Object.keys(
  documentImportStatusLabels
) as [
  keyof typeof documentImportStatusLabels,
  ...(keyof typeof documentImportStatusLabels)[],
];

export type DocumentImportStatus = keyof typeof documentImportStatusLabels;

/** What kind of document the model believes it is looking at. */
export const documentImportKindLabels = {
  consent_form: 'Consent form',
  id_document: 'ID document',
  intake_form: 'Intake form',
  invoice: 'Invoice / receipt',
  referral: 'Referral letter',
  treatment_record: 'Treatment record',
  photo: 'Photo',
  other: 'Other',
} as const;

export const documentImportKindValues = Object.keys(
  documentImportKindLabels
) as [
  keyof typeof documentImportKindLabels,
  ...(keyof typeof documentImportKindLabels)[],
];

export type DocumentImportKind = keyof typeof documentImportKindLabels;

/** How a matched import got its client. */
export const documentImportMatchSourceLabels = {
  auto: 'Matched automatically',
  manual: 'Assigned by staff',
} as const;

export const documentImportMatchSourceValues = Object.keys(
  documentImportMatchSourceLabels
) as [
  keyof typeof documentImportMatchSourceLabels,
  ...(keyof typeof documentImportMatchSourceLabels)[],
];

export type DocumentImportMatchSource =
  keyof typeof documentImportMatchSourceLabels;
