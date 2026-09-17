import { z } from 'zod';
import {
  deduplicateByValues,
  onDuplicateValues,
} from '../../../shared/labels.js';

/** Hard cap on the uploaded file — anything bigger must be split by the user. */
export const MAX_CSV_BYTES = 1_048_576; // 1 MB

/** base64 inflates ~4/3, plus a little slack for padding. */
const MAX_FILE_BASE64_CHARS = 1_500_000;

/**
 * One of `csv` (raw text contents, the original transport) or `fileBase64`
 * (base64 bytes of a .csv/.xlsx file) must be provided — enforced in the
 * service, not via `.refine()`, so the API DTO can still `.omit()` fields.
 */
export const importLeadsCsvSchema = z.object({
  organizationId: z.string().min(1, 'Organization ID is required'),
  /** Raw CSV file contents, header row included. */
  csv: z
    .string()
    .min(1, 'CSV is empty')
    .max(MAX_CSV_BYTES, 'CSV must be 1 MB or smaller')
    .optional(),
  /** Base64-encoded file bytes (.csv or .xlsx), for binary uploads. */
  fileBase64: z
    .string()
    .min(1, 'File is empty')
    .max(MAX_FILE_BASE64_CHARS, 'File must be 1 MB or smaller')
    .optional(),
  /** Original filename — used to pick the parser (.xlsx vs .csv). */
  fileName: z.string().max(255).optional(),
  deduplicateBy: z.enum(deduplicateByValues).default('email'),
  onDuplicate: z.enum(onDuplicateValues).default('skip'),
  /** Same compliance gate as the structured import — must be explicit. */
  consentAcknowledgment: z.boolean().refine((val) => val === true, {
    message:
      'You must confirm that these leads have provided consent to be contacted',
  }),
  // Uploaded lists arrive with the uploader's confirmation that these people
  // agreed to be contacted, so channels default to consented (unlike manual
  // entry, where the user picks per channel).
  defaultConsentEmail: z.boolean().optional().default(true),
  defaultConsentSms: z.boolean().optional().default(true),
  defaultConsentVoice: z.boolean().optional().default(true),
});

export type ImportLeadsCsvInput = z.infer<typeof importLeadsCsvSchema>;
