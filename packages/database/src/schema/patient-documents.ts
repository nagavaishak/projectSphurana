import { createId } from '@paralleldrive/cuid2';
import {
  index,
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
} from 'drizzle-orm/pg-core';
import { lead } from './leads.js';
import { organization } from './organization.js';
import { user } from './user.js';

import { orgRlsPolicy, patientSelfRlsPolicy } from '../rls-policy.js';

import {
  patientDocumentUploadedByLabels,
  patientDocumentUploadedByValues,
} from '@borradh-workspace/labels';

// Re-export labels and types for consumers
export { patientDocumentUploadedByLabels, patientDocumentUploadedByValues };
export type { PatientDocumentUploadedBy } from '@borradh-workspace/labels';

export const patientDocumentUploadedByEnum = pgEnum(
  'patient_document_uploaded_by',
  patientDocumentUploadedByValues
);

/**
 * Patient document vault (ENG-647 Phase 4) — files stored against a
 * patient's record: previous treatment reports, referral letters, ID, etc.
 *
 * Deliberately SEPARATE from `asset` (marketing source media): different
 * access rules (patient can see their own; org-scoped for staff), different
 * retention posture, and clinical files must never surface in the marketing
 * media picker. Stored in the private org-assets bucket under a
 * patient-documents prefix (UploadPurpose 'patient-document').
 */
export const patientDocument = pgTable(
  'patient_document',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => createId()),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
    leadId: text('lead_id')
      .notNull()
      .references(() => lead.id, { onDelete: 'cascade' }),
    uploadedByType: patientDocumentUploadedByEnum('uploaded_by_type').notNull(),
    /** Set when a staff member uploaded on the patient's behalf. */
    uploadedByUserId: text('uploaded_by_user_id').references(() => user.id, {
      onDelete: 'set null',
    }),
    fileName: text('file_name').notNull(),
    blobUrl: text('blob_url').notNull(),
    mimeType: text('mime_type').notNull(),
    sizeBytes: integer('size_bytes').notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    deletedAt: timestamp('deleted_at'),
  },
  (table) => [
    index('idx_patient_document_org_id').on(table.organizationId),
    index('idx_patient_document_lead_id').on(table.leadId),
  ]
);

export const patientDocumentRlsPolicy = orgRlsPolicy(patientDocument);
/** Patients read their own documents in the portal. */
export const patientDocumentPatientSelfPolicy =
  patientSelfRlsPolicy(patientDocument);

// Types
export type PatientDocument = typeof patientDocument.$inferSelect;
export type NewPatientDocument = typeof patientDocument.$inferInsert;
