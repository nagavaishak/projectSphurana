import { trackedResult } from '@borradh-workspace/observability';
import {
  type DbConnection,
  ErrorCodes,
  FeatureError,
  type Result,
  err,
  ok,
} from '../../../shared/index.js';
import { exportLeads } from '../export-leads/export-leads.service.js';
import {
  type ExportLeadsCsvInput,
  exportLeadsCsvSchema,
} from './export-leads-csv.schema.js';

/**
 * A `trackedResult`-wrapped call surfaces its failure as a plain shape, not a
 * `FeatureError` instance. Rebuild one — code, message AND details (the zod
 * issues) — so the composed result is indistinguishable from calling the inner
 * service directly.
 */
const rewrap = (error: {
  code: string;
  message: string;
  details?: Record<string, unknown>;
}) => new FeatureError(error.code, error.message, error.details);

/** Column order is the file format — changing it changes every user's export. */
const HEADERS = [
  'First Name',
  'Last Name',
  'Email',
  'Phone',
  'WhatsApp',
  'Source',
  'Status',
  'Tags',
  'Notes',
  'Consent Email',
  'Consent SMS',
  'Consent Voice',
  'Created At',
] as const;

/** RFC-4180 quoting: only fields containing a delimiter, quote or newline. */
const escapeCsv = (val: string | null | undefined): string => {
  if (val == null) return '';
  const str = String(val);
  if (str.includes(',') || str.includes('"') || str.includes('\n')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
};

export interface ExportLeadsCsvData {
  /** The whole file, newline-joined. */
  csv: string;
  /** `leads-export-YYYY-MM-DD.csv`, dated in UTC. */
  filename: string;
}

const exportLeadsToCsvImpl = async (
  db: DbConnection,
  input: ExportLeadsCsvInput
): Promise<Result<ExportLeadsCsvData>> => {
  const parsed = exportLeadsCsvSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  const result = await exportLeads(db, parsed.data);
  if (!result.success) return err(rewrap(result.error));

  const rows = result.data.items.map((item) =>
    [
      escapeCsv(item.firstName),
      escapeCsv(item.lastName),
      escapeCsv(item.email),
      escapeCsv(item.phone),
      escapeCsv(item.whatsapp),
      escapeCsv(item.source),
      escapeCsv(item.status),
      escapeCsv(item.tags?.join('; ')),
      escapeCsv(item.notes),
      escapeCsv(item.consentEmail ? 'Yes' : 'No'),
      escapeCsv(item.consentSms ? 'Yes' : 'No'),
      escapeCsv(item.consentVoice ? 'Yes' : 'No'),
      escapeCsv(item.createdAt?.toISOString()),
    ].join(',')
  );

  return ok({
    csv: [HEADERS.join(','), ...rows].join('\n'),
    filename: `leads-export-${new Date().toISOString().slice(0, 10)}.csv`,
  });
};

/**
 * Export an organization's leads as a CSV document.
 *
 * The controller only sets the two response headers and writes the body — the
 * column set, escaping and filename all live here so they are testable and
 * shared.
 */
export const exportLeadsToCsv = (
  db: DbConnection,
  input: ExportLeadsCsvInput
) =>
  trackedResult(
    'leads.exportLeadsToCsv',
    () => exportLeadsToCsvImpl(db, input),
    { properties: { organizationId: input.organizationId } }
  );

export type ExportLeadsCsvResult = Awaited<ReturnType<typeof exportLeadsToCsv>>;
