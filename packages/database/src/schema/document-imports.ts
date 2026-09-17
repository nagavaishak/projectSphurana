import { createId } from '@paralleldrive/cuid2';
import {
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  real,
  text,
  timestamp,
} from 'drizzle-orm/pg-core';
import { lead } from './leads.js';
import { organization } from './organization.js';
import { patientDocument } from './patient-documents.js';
import { user } from './user.js';

import { orgRlsPolicy } from '../rls-policy.js';

import {
  documentImportKindLabels,
  documentImportKindValues,
  documentImportMatchSourceLabels,
  documentImportMatchSourceValues,
  documentImportStatusLabels,
  documentImportStatusValues,
} from '@borradh-workspace/labels';

// Re-export labels and types for consumers
export {
  documentImportKindLabels,
  documentImportKindValues,
  documentImportMatchSourceLabels,
  documentImportMatchSourceValues,
  documentImportStatusLabels,
  documentImportStatusValues,
};
export type {
  DocumentImportKind,
  DocumentImportMatchSource,
  DocumentImportStatus,
} from '@borradh-workspace/labels';

export const documentImportStatusEnum = pgEnum(
  'document_import_status',
  documentImportStatusValues
);
export const documentImportKindEnum = pgEnum(
  'document_import_kind',
  documentImportKindValues
);
export const documentImportMatchSourceEnum = pgEnum(
  'document_import_match_source',
  documentImportMatchSourceValues
);

/** What the model read off the document. Stored for review + audit. */
export interface DocumentImportExtracted {
  personName: string | null;
  email: string | null;
  phone: string | null;
  dateOfBirth: string | null;
  /** Any dates on the document (appointment, signature, invoice) as ISO-ish strings. */
  dates: string[];
  /** One-line description of the document for the review UI. */
  summary: string | null;
}

/** A client the matcher considered, with why. */
export interface DocumentImportCandidate {
  leadId: string;
  name: string;
  /** Which identity signals agreed: 'email' | 'phone' | 'name'. */
  matchedOn: string[];
  /** 0–1, deterministic score from the retrieval step. */
  score: number;
}

/**
 * Staging row for the bulk "Import Documents" flow (ENG-784).
 *
 * A `patient_document` needs a `lead_id` up front (its S3 key embeds it), so
 * a file whose owner is not yet known cannot live there. It lives HERE, under
 * `document-imports/{orgId}/{importId}/…` in the private org-assets bucket,
 * until the matcher (or a person) decides. Matching copies the object into the
 * client's vault and records a `patient_document`; this row is kept as the
 * audit trail (who uploaded, what the model read, how confident it was).
 */
export const documentImport = pgTable(
  'document_import',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => createId()),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
    uploadedByUserId: text('uploaded_by_user_id').references(() => user.id, {
      onDelete: 'set null',
    }),
    fileName: text('file_name').notNull(),
    /** S3 key of the staged object in the org-assets bucket. */
    storageKey: text('storage_key').notNull(),
    mimeType: text('mime_type').notNull(),
    sizeBytes: integer('size_bytes').notNull(),
    status: documentImportStatusEnum('status').notNull().default('uploading'),
    documentKind: documentImportKindEnum('document_kind'),
    matchedLeadId: text('matched_lead_id').references(() => lead.id, {
      onDelete: 'set null',
    }),
    matchSource: documentImportMatchSourceEnum('match_source'),
    /** The vault row this import became, once matched. */
    patientDocumentId: text('patient_document_id').references(
      () => patientDocument.id,
      { onDelete: 'set null' }
    ),
    /** 0–1 confidence of the match (auto) — null for manual assignments. */
    confidence: real('confidence'),
    extracted: jsonb('extracted').$type<DocumentImportExtracted>(),
    candidates: jsonb('candidates').$type<DocumentImportCandidate[]>(),
    /** Model's one-line justification for the pick (or for declining). */
    matchReason: text('match_reason'),
    failureReason: text('failure_reason'),
    processedAt: timestamp('processed_at'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at')
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
    deletedAt: timestamp('deleted_at'),
  },
  (table) => [
    index('idx_document_import_org_status').on(
      table.organizationId,
      table.status
    ),
    index('idx_document_import_org_created').on(
      table.organizationId,
      table.createdAt
    ),
    index('idx_document_import_matched_lead').on(table.matchedLeadId),
  ]
);

export const documentImportRlsPolicy = orgRlsPolicy(documentImport);

// Types
export type DocumentImport = typeof documentImport.$inferSelect;
export type NewDocumentImport = typeof documentImport.$inferInsert;
