import {
  MODELS,
  chatCompletion,
  initAIClient,
  isAIClientInitialized,
  parseJsonResponse,
} from '@borradh-workspace/ai';
import { withOrgScope } from '@borradh-workspace/database';
import { apiEnv } from '@borradh-workspace/env/api';
import { logError, trackedResult } from '@borradh-workspace/observability';
import { z } from 'zod';
import {
  createCategory,
  listCategories,
} from '../../../service-categories/index.js';
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
import { createService } from '../create-service/index.js';
import { updateService } from '../update-service/index.js';
import {
  type ImportServicesCsvInput,
  type ImportServicesCsvSummary,
  MAX_IMPORT_SERVICE_ROWS,
  MAX_SERVICES_FILE_BYTES,
  type ServiceImportError,
  importServicesCsvSchema,
} from './import-services-csv.schema.js';
import {
  MAPPABLE_SERVICE_FIELDS,
  type MappableServiceField,
  type ServiceRowDraft,
  buildServiceRows,
  mapServiceHeadersHeuristically,
} from './map-service-columns.js';

/**
 * Spreadsheet (.csv / .xlsx) → service catalogue.
 *
 * The catalogue twin of `leads.importLeadsCsv`, and deliberately the same
 * shape: a clinic switching from Fresha/Phorest/Timely exports whatever that
 * system produces, so the file is parsed DETERMINISTICALLY (shared RFC 4180 /
 * xlsx reader), headers are mapped by a synonym table, and only the columns
 * the heuristics could not place are sent to ONE `gpt-5.6-luna` call. AI being
 * unavailable or failing never fails the import — it just means a stray column
 * lands in the description instead of a field.
 *
 * Writes go through `createService` / `updateService` rather than a bulk
 * INSERT, so the price-shape normalisation, the name-uniqueness constraint and
 * the stock-footage matching that hang off those services all apply to
 * imported rows exactly as they do to hand-entered ones.
 */

/** Row ceiling handed to the shared parser (+1 for the header row). */
const PARSE_LIMITS = {
  maxRows: MAX_IMPORT_SERVICE_ROWS + 1,
  noun: 'services',
} as const;

/** Ceiling on categories one import may invent, so a mis-mapped column
 *  (a description column read as "category") cannot spray the catalogue. */
const MAX_NEW_CATEGORIES = 50;

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
 * One shot at identifying the columns the synonym table couldn't. Receives ALL
 * headers (with the heuristic guesses locked in) plus a few sample rows, and
 * returns field names only for the unresolved columns. Best-effort: any
 * failure returns null and the caller proceeds with the heuristic mapping.
 */
async function aiAssistMapping(
  headers: string[],
  mapping: (MappableServiceField | null)[],
  sampleRows: string[][],
  organizationId: string
): Promise<(MappableServiceField | null)[] | null> {
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
      `Columns of a spreadsheet exported from a salon/clinic booking system, being imported as a service (treatment) catalogue:\n${columnLines}\n\nFor each UNRESOLVED column, decide which service field it holds. Respond with JSON {"mapping": {"<column index>": "<field>"}} using only these fields: ${MAPPABLE_SERVICE_FIELDS.join(', ')}. "name" is the treatment name, "price" the amount charged, "duration" the appointment length, "category" the grouping it is filed under. Use "ignore" for columns that hold no catalogue data (row numbers, internal IDs, staff names, tax rates, booleans, timestamps). Use "notes" for useful free text. Only include unresolved columns.`,
      {
        model: MODELS.cheap,
        temperature: 0,
        maxTokens: 800,
        jsonResponse: true,
        timeoutMs: 20_000,
        systemMessage:
          'You map spreadsheet columns to service-catalogue fields. Answer with strict JSON only.',
        observability: {
          spanName: 'organizationServices.importServicesCsv.mapColumns',
          properties: { organizationId, unresolved: unresolved.length },
        },
      }
    );

    const parsed = parseJsonResponse(res.content, { schema: aiMappingSchema });
    if (!parsed.success || !parsed.data) return null;

    const merged = [...mapping];
    // Single-slot fields the heuristics already claimed stay claimed — the AI
    // may only fill holes, never re-point a column the synonym table resolved.
    const taken = new Set(
      mapping.filter((m): m is MappableServiceField => !!m)
    );
    for (const [key, field] of Object.entries(parsed.data.mapping)) {
      const idx = Number(key);
      if (!Number.isInteger(idx) || idx < 0 || idx >= headers.length) continue;
      if (merged[idx] !== null) continue; // heuristics win
      if (!(MAPPABLE_SERVICE_FIELDS as readonly string[]).includes(field)) {
        continue;
      }
      const typed = field as MappableServiceField;
      if (typed !== 'notes' && typed !== 'ignore') {
        if (taken.has(typed)) continue;
        taken.add(typed);
      }
      merged[idx] = typed;
    }
    return merged;
  } catch (error) {
    logError('organizationServices.importServicesCsv.mapColumns', error, {
      feature: 'organizationServices',
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
    if (bytes.byteLength > MAX_SERVICES_FILE_BYTES) {
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
    if (Buffer.byteLength(input.csv, 'utf8') > MAX_SERVICES_FILE_BYTES) {
      throw new SpreadsheetParseError('CSV must be 1 MB or smaller');
    }
    return parseCsv(input.csv, PARSE_LIMITS);
  }
  throw new SpreadsheetParseError('No file provided');
}

/** Case/whitespace-insensitive key, so "Body Treatments" matches "body treatments". */
const foldName = (name: string) =>
  name.trim().toLowerCase().replace(/\s+/g, ' ');

/**
 * Resolve every category NAME the file used to a category ID, creating the
 * ones the org doesn't have yet when asked to. Returns the lookup plus how
 * many rows it created; a failure to create one category is not fatal — those
 * services just import uncategorised.
 */
async function resolveCategoryIds(
  db: DbConnection,
  organizationId: string,
  names: string[],
  createMissing: boolean
): Promise<{ idsByName: Map<string, string>; created: number }> {
  const idsByName = new Map<string, string>();
  if (names.length === 0) return { idsByName, created: 0 };

  const existing = await listCategories(db, { organizationId });
  if (!existing.success) return { idsByName, created: 0 };
  for (const category of existing.data) {
    idsByName.set(foldName(category.name), category.id);
  }
  if (!createMissing) return { idsByName, created: 0 };

  let created = 0;
  let sortOrder = existing.data.length;
  for (const name of names) {
    if (idsByName.has(foldName(name))) continue;
    if (created >= MAX_NEW_CATEGORIES) break;
    const result = await createCategory(db, {
      organizationId,
      name,
      sortOrder: sortOrder++,
      isActive: true,
    });
    if (result.success) {
      idsByName.set(foldName(name), result.data.id);
      created++;
    }
  }
  return { idsByName, created };
}

const importServicesCsvImpl = async (
  db: DbConnection,
  input: ImportServicesCsvInput
) => {
  const parsed = importServicesCsvSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }
  const {
    organizationId,
    onDuplicate,
    createMissingCategories,
    importAsInactive,
  } = parsed.data;

  let matrix: string[][];
  try {
    matrix = parseUpload(parsed.data);
  } catch (error) {
    if (error instanceof SpreadsheetParseError) {
      return err(new FeatureError(ErrorCodes.VALIDATION_ERROR, error.message));
    }
    logError('organizationServices.importServicesCsv.parse', error, {
      feature: 'organizationServices',
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
        'The file needs a header row and at least one service row'
      )
    );
  }
  const [headers, ...dataRows] = matrix;
  if (dataRows.length > MAX_IMPORT_SERVICE_ROWS) {
    return err(
      new FeatureError(
        ErrorCodes.VALIDATION_ERROR,
        `That's too many rows for one import — split the file and try again (max ${MAX_IMPORT_SERVICE_ROWS} rows)`
      )
    );
  }

  // Identify columns: synonym table first, then ONE optional AI call for
  // whatever's left. The import works fully without AI.
  let mapping = mapServiceHeadersHeuristically(headers);
  if (mapping.some((m) => m === null)) {
    const assisted = await aiAssistMapping(
      headers,
      mapping,
      dataRows.slice(0, 3),
      organizationId
    );
    if (assisted) mapping = assisted;
  }

  const { rows, skippedRows } = buildServiceRows(headers, mapping, dataRows);
  if (rows.length === 0) {
    return err(
      new FeatureError(
        ErrorCodes.VALIDATION_ERROR,
        mapping.every((m) => m === null || m === 'ignore')
          ? 'Could not recognise any service columns (name, price, duration…) in the file'
          : 'No services found in the file — every row was missing a name'
      )
    );
  }

  const { idsByName, created: categoriesCreated } = await resolveCategoryIds(
    db,
    organizationId,
    [
      ...new Set(
        rows
          .map((r) => r.categoryName)
          .filter((n): n is string => Boolean(n?.trim()))
      ),
    ],
    createMissingCategories
  );

  // Existing catalogue, so a duplicate name is a decision (skip/update) rather
  // than an ALREADY_EXISTS error surfaced to the user as a failed row.
  const existingByName = new Map<string, string>();
  const catalogue = await withOrgScope(
    (tx) =>
      tx.query.organizationService.findMany({
        where: (svc, { eq }) => eq(svc.organizationId, organizationId),
        columns: { id: true, name: true },
      }),
    { db }
  );
  for (const svc of catalogue) existingByName.set(foldName(svc.name), svc.id);

  const errors: ServiceImportError[] = [];
  let imported = 0;
  let skipped = 0;
  let updated = 0;

  // Sequential, not Promise.all: `createService` does a read-then-insert on
  // (organizationId, name), so two rows naming the same service concurrently
  // would race the uniqueness constraint. A catalogue is at most 1000 rows.
  for (const [index, row] of rows.entries()) {
    // +2 = 1-based row numbers plus the header, so the number matches what the
    // user sees in Excel.
    const rowNumber = index + 2;
    const fields = toServiceFields(row, idsByName, importAsInactive);
    const existingId = existingByName.get(foldName(row.name));

    if (existingId) {
      if (onDuplicate === 'skip') {
        skipped++;
        continue;
      }
      const result = await updateService(db, {
        id: existingId,
        organizationId,
        ...fields,
      });
      if (result.success) updated++;
      else {
        errors.push({
          row: rowNumber,
          message: result.error.message,
          data: { name: row.name },
        });
      }
      continue;
    }

    const result = await createService(db, {
      organizationId,
      // `CreateServiceInput` is the schema's OUTPUT type, so the keys that
      // carry a `.default()` are required here even though a client POSTing
      // this body could omit them. These four are exactly those defaults.
      category: 'treatment',
      sortOrder: 0,
      isCustom: true,
      requiresDeposit: false,
      ...fields,
    });
    if (result.success) {
      imported++;
      // A file that lists the same service twice must not fail its second row.
      existingByName.set(foldName(row.name), result.data.id);
    } else if (result.error.code === ErrorCodes.ALREADY_EXISTS) {
      skipped++;
    } else {
      errors.push({
        row: rowNumber,
        message: result.error.message,
        data: { name: row.name },
      });
    }
  }

  // Header → field summary (skipping ignored/unmapped), for QA/transparency.
  const columnMapping: Record<string, string> = {};
  headers.forEach((header, i) => {
    const field = mapping[i];
    if (field && field !== 'ignore' && header.trim()) {
      columnMapping[header.trim()] = field;
    }
  });

  const summary: ImportServicesCsvSummary = {
    imported,
    skipped,
    updated,
    errors,
    rowsInFile: dataRows.length,
    cleanedRows: rows.length,
    skippedRows,
    categoriesCreated,
    columnMapping,
  };
  return ok(summary);
};

/**
 * Draft → the fields `createService`/`updateService` accept.
 *
 * `categoryName` becomes a `categoryId` only when the org actually has (or
 * just got) that category; an unmatched name is dropped rather than guessed at,
 * because the row's description already carries the file's own text.
 */
function toServiceFields(
  row: ServiceRowDraft,
  idsByName: ReadonlyMap<string, string>,
  importAsInactive: boolean
) {
  const categoryId = row.categoryName
    ? (idsByName.get(foldName(row.categoryName)) ?? null)
    : null;

  return {
    name: row.name,
    description: row.description,
    categoryId,
    isActive: !importAsInactive,
    // Absent from the file means "no opinion", and the create service infers
    // `poa` from a missing price. Sending an explicit undefined keeps the
    // update path's PATCH semantics intact for the same reason.
    priceType: row.priceType,
    priceCents: row.priceCents,
    appointmentDuration: row.appointmentDuration,
  };
}

export const importServicesCsv = (
  db: DbConnection,
  input: ImportServicesCsvInput
) =>
  trackedResult(
    'organizationServices.importServicesCsv',
    () => importServicesCsvImpl(db, input),
    {
      properties: {
        organizationId: input.organizationId,
        fileChars: input.csv?.length ?? input.fileBase64?.length ?? 0,
        fileName: input.fileName,
      },
    }
  );

export type ImportServicesCsvResult = Awaited<
  ReturnType<typeof importServicesCsv>
>;
