import { z } from 'zod';

/** Hard cap on the uploaded file — anything bigger must be split by the user. */
export const MAX_SERVICES_FILE_BYTES = 1_048_576; // 1 MB

/** base64 inflates ~4/3, plus a little slack for padding. */
const MAX_FILE_BASE64_CHARS = 1_500_000;

/** A catalogue is not a mailing list — 1000 services is already a huge one. */
export const MAX_IMPORT_SERVICE_ROWS = 1_000;

/** What to do with a row whose name already exists in the catalogue. */
export const importServicesOnDuplicateValues = ['skip', 'update'] as const;
export type ImportServicesOnDuplicate =
  (typeof importServicesOnDuplicateValues)[number];

/**
 * `POST /organization-services/import-csv` body (plus the server-injected
 * `organizationId`).
 *
 * One of `csv` (raw text contents) or `fileBase64` (base64 bytes of a
 * .csv/.xlsx file) must be provided — enforced in the service rather than via
 * `.refine()`, so the API DTO can still `.omit()` the org id.
 *
 * There is deliberately no consent gate here, unlike the leads import: a
 * service catalogue is the org's own data about itself, not personal data
 * about third parties.
 */
export const importServicesCsvSchema = z.object({
  organizationId: z.string().min(1, 'Organization ID is required'),
  /** Raw CSV file contents, header row included. */
  csv: z
    .string()
    .min(1, 'CSV is empty')
    .max(MAX_SERVICES_FILE_BYTES, 'CSV must be 1 MB or smaller')
    .optional(),
  /** Base64-encoded file bytes (.csv or .xlsx), for binary uploads. */
  fileBase64: z
    .string()
    .min(1, 'File is empty')
    .max(MAX_FILE_BASE64_CHARS, 'File must be 1 MB or smaller')
    .optional(),
  /** Original filename — used to pick the parser (.xlsx vs .csv). */
  fileName: z.string().max(255).optional(),
  /**
   * Existing service of the same name: leave it alone, or overwrite the fields
   * the file supplies. `skip` is the default because an import is usually an
   * ADDITION to a catalogue someone has already tuned by hand.
   */
  onDuplicate: z.enum(importServicesOnDuplicateValues).default('skip'),
  /**
   * Create the org's categories from the file's category column when they
   * don't exist yet. Off means unrecognised categories are only matched, never
   * created, and unmatched rows land uncategorised.
   */
  createMissingCategories: z.boolean().optional().default(true),
  /** Import the services switched off, so the clinic can review before they go live. */
  importAsInactive: z.boolean().optional().default(false),
});

export type ImportServicesCsvInput = z.infer<typeof importServicesCsvSchema>;

/** A row the import could not create. */
export interface ServiceImportError {
  row: number;
  message: string;
  data?: Record<string, unknown>;
}

export interface ImportServicesCsvSummary {
  imported: number;
  skipped: number;
  updated: number;
  errors: ServiceImportError[];
  /** Data rows in the file, excluding the header. */
  rowsInFile: number;
  /** Rows that survived parsing and had a usable name. */
  cleanedRows: number;
  /** Rows dropped for having no service name. */
  skippedRows: number;
  /** Categories created because the file named them and the org had none. */
  categoriesCreated: number;
  /** Header → service-field mapping the import used, for transparency. */
  columnMapping: Record<string, string>;
}
