import {
  chatCompletion,
  initAIClient,
  isAIClientInitialized,
  parseJsonResponse,
} from '@borradh-workspace/ai';
import { apiEnv } from '@borradh-workspace/env/api';
import { logError, trackedResult } from '@borradh-workspace/observability';
import { z } from 'zod';
import {
  type DbConnection,
  ErrorCodes,
  FeatureError,
  err,
  ok,
} from '../../../shared/index.js';
import {
  SpreadsheetParseError,
  looksLikeLegacyXls,
  looksLikeXlsx,
  parseCsv,
  parseXlsx,
} from '../../../shared/spreadsheet/parse-spreadsheet.js';
import { importLeads } from '../import-leads/index.js';
import {
  type ImportLeadsCsvInput,
  MAX_CSV_BYTES,
  importLeadsCsvSchema,
} from './import-leads-csv.schema.js';
import {
  MAPPABLE_FIELDS,
  type MappableField,
  buildRows,
  mapHeadersHeuristically,
} from './map-columns.js';

/**
 * Spreadsheet (.csv / .xlsx) → leads.
 *
 * Users upload whatever their old system exported — inconsistent columns,
 * "Sarah / no surname", phones like "087 684 6467". The file is parsed
 * DETERMINISTICALLY (RFC 4180 CSV or minimal xlsx reader), headers are mapped
 * to lead fields by a synonym table, and only when the heuristics leave gaps
 * is a single, optional AI call used to identify the remaining columns. AI
 * being unavailable or failing never fails the import. Unmapped columns are
 * preserved as "Header: value" note lines, then everything is handed to the
 * existing `importLeads` dedup/insert pipeline.
 */

const MAX_IMPORT_ROWS = 5_000; // matches importLeadsSchema's array cap

/** Row ceiling handed to the shared parser (+1 for the header row). */
const PARSE_LIMITS = { maxRows: MAX_IMPORT_ROWS + 1, noun: 'leads' } as const;

/** True when an AI client is usable — mapping assist is skipped otherwise. */
function ensureAIClientAvailable(): boolean {
  if (isAIClientInitialized()) return true;
  const apiKey = apiEnv.OPENAI_API_KEY;
  if (!apiKey) return false;
  initAIClient({ apiKey });
  return true;
}

const aiMappingSchema = z.object({
  mapping: z.record(z.string(), z.string()),
});

/**
 * One shot at identifying the columns the synonym table couldn't. Receives
 * ALL headers (with the heuristic guesses locked in) plus a few sample rows;
 * returns field names only for the unresolved columns. Best-effort: any
 * failure returns null and the caller proceeds with the heuristic mapping.
 */
async function aiAssistMapping(
  headers: string[],
  mapping: (MappableField | null)[],
  sampleRows: string[][],
  organizationId: string
): Promise<(MappableField | null)[] | null> {
  try {
    if (!ensureAIClientAvailable()) return null;

    const unresolved = headers
      .map((header, i) => ({ header, i }))
      .filter(({ i }) => mapping[i] === null);
    if (unresolved.length === 0) return null;

    const columnLines = headers
      .map((header, i) => {
        const state = mapping[i] ? `mapped to ${mapping[i]}` : 'UNRESOLVED';
        const samples = sampleRows
          .map((r) => (r[i] ?? '').trim())
          .filter(Boolean)
          .slice(0, 3)
          .map((v) => JSON.stringify(v.slice(0, 80)))
          .join(', ');
        return `- column ${i} "${header}" (${state})${samples ? ` — sample values: ${samples}` : ''}`;
      })
      .join('\n');

    const res = await chatCompletion(
      `Columns of a spreadsheet of sales leads being imported into a CRM:\n${columnLines}\n\nFor each UNRESOLVED column, decide which lead field it holds. Respond with JSON {"mapping": {"<column index>": "<field>"}} using only these fields: ${MAPPABLE_FIELDS.join(', ')}. Use "ignore" for columns that hold no useful lead data (row numbers, internal IDs, booleans). Use "notes" for useful free text. Only include unresolved columns.`,
      {
        temperature: 0,
        maxTokens: 800,
        jsonResponse: true,
        timeoutMs: 20_000,
        systemMessage:
          'You map spreadsheet columns to CRM lead fields. Answer with strict JSON only.',
        observability: {
          spanName: 'leads.importLeadsCsv.mapColumns',
          properties: { organizationId, unresolved: unresolved.length },
        },
      }
    );

    const parsed = parseJsonResponse(res.content, {
      schema: aiMappingSchema,
    });
    if (!parsed.success || !parsed.data) return null;

    const merged = [...mapping];
    for (const [key, field] of Object.entries(parsed.data.mapping)) {
      const idx = Number(key);
      if (!Number.isInteger(idx) || idx < 0 || idx >= headers.length) continue;
      if (merged[idx] !== null) continue; // heuristics win
      if ((MAPPABLE_FIELDS as readonly string[]).includes(field)) {
        merged[idx] = field as MappableField;
      }
    }
    return merged;
  } catch (error) {
    logError('leads.importLeadsCsv.mapColumns', error, {
      feature: 'leads',
      extra: { organizationId },
    });
    return null;
  }
}

/** Decode the upload into a cell matrix, whatever shape it arrived in. */
function parseUpload(input: {
  csv?: string;
  fileBase64?: string;
  fileName?: string;
}): string[][] {
  if (input.fileBase64) {
    const bytes = Buffer.from(input.fileBase64, 'base64');
    if (bytes.byteLength > MAX_CSV_BYTES) {
      throw new SpreadsheetParseError('File must be 1 MB or smaller');
    }
    if (looksLikeLegacyXls(bytes)) {
      throw new SpreadsheetParseError(
        'Legacy .xls files are not supported — save the file as .xlsx or .csv and try again'
      );
    }
    if (
      looksLikeXlsx(bytes) ||
      input.fileName?.toLowerCase().endsWith('.xlsx')
    ) {
      return parseXlsx(new Uint8Array(bytes), PARSE_LIMITS);
    }
    return parseCsv(bytes.toString('utf8'), PARSE_LIMITS);
  }
  if (input.csv) {
    if (Buffer.byteLength(input.csv, 'utf8') > MAX_CSV_BYTES) {
      throw new SpreadsheetParseError('CSV must be 1 MB or smaller');
    }
    return parseCsv(input.csv, PARSE_LIMITS);
  }
  throw new SpreadsheetParseError('No file provided');
}

const importLeadsCsvImpl = async (
  db: DbConnection,
  input: ImportLeadsCsvInput
) => {
  const parsed = importLeadsCsvSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }
  const {
    organizationId,
    deduplicateBy,
    onDuplicate,
    consentAcknowledgment,
    defaultConsentEmail,
    defaultConsentSms,
    defaultConsentVoice,
  } = parsed.data;

  let matrix: string[][];
  try {
    matrix = parseUpload(parsed.data);
  } catch (error) {
    if (error instanceof SpreadsheetParseError) {
      return err(new FeatureError(ErrorCodes.VALIDATION_ERROR, error.message));
    }
    logError('leads.importLeadsCsv.parse', error, {
      feature: 'leads',
      extra: { organizationId, fileName: parsed.data.fileName },
    });
    return err(
      new FeatureError(
        ErrorCodes.VALIDATION_ERROR,
        'Could not read the file. Save it as .csv or .xlsx and try again.'
      )
    );
  }

  if (matrix.length < 2) {
    return err(
      new FeatureError(
        ErrorCodes.VALIDATION_ERROR,
        'The file needs a header row and at least one lead row'
      )
    );
  }
  const [headers, ...dataRows] = matrix;
  if (dataRows.length > MAX_IMPORT_ROWS) {
    return err(
      new FeatureError(
        ErrorCodes.VALIDATION_ERROR,
        `That's too many rows for one import — split the file and try again (max ${MAX_IMPORT_ROWS} rows)`
      )
    );
  }

  // Identify columns: synonym table first, then ONE optional AI call for
  // whatever's left. The import works fully without AI.
  let mapping = mapHeadersHeuristically(headers);
  if (mapping.some((m) => m === null)) {
    const assisted = await aiAssistMapping(
      headers,
      mapping,
      dataRows.slice(0, 3),
      organizationId
    );
    if (assisted) mapping = assisted;
  }

  const { rows, skippedRows } = buildRows(headers, mapping, dataRows);
  if (rows.length === 0) {
    return err(
      new FeatureError(
        ErrorCodes.VALIDATION_ERROR,
        mapping.every((m) => m === null || m === 'ignore')
          ? 'Could not recognise any lead columns (name, email, phone…) in the file'
          : 'No leads found in the file'
      )
    );
  }

  const imported = await importLeads(db, {
    organizationId,
    leads: rows,
    deduplicateBy,
    onDuplicate,
    consentAcknowledgment,
    defaultConsentEmail,
    defaultConsentSms,
    defaultConsentVoice,
  });
  if (!imported.success) return imported;

  // Header → field summary (skipping ignored/unmapped), for QA/transparency.
  const columnMapping: Record<string, string> = {};
  headers.forEach((header, i) => {
    const field = mapping[i];
    if (field && field !== 'ignore' && header.trim()) {
      columnMapping[header.trim()] = field;
    }
  });

  return ok({
    ...imported.data,
    rowsInFile: dataRows.length,
    cleanedRows: rows.length,
    skippedRows,
    columnMapping,
    /** @deprecated pre-deterministic-parser counter, always 0 now. */
    failedChunks: 0,
  });
};

export const importLeadsCsv = (db: DbConnection, input: ImportLeadsCsvInput) =>
  trackedResult('leads.importLeadsCsv', () => importLeadsCsvImpl(db, input), {
    properties: {
      organizationId: input.organizationId,
      fileChars: input.csv?.length ?? input.fileBase64?.length ?? 0,
      fileName: input.fileName,
    },
  });

export type ImportLeadsCsvResult = Awaited<ReturnType<typeof importLeadsCsv>>;
