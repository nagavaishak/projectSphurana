import { XMLParser } from 'fast-xml-parser';
import { unzipSync } from 'fflate';

/**
 * Deterministic spreadsheet parsing shared by every "upload your old system's
 * export" import: RFC 4180 CSV (quoted fields, embedded newlines, CRLF, BOM,
 * `,`/`;`/tab delimiters) and minimal .xlsx (first worksheet, shared/inline
 * strings, cached formula values). Both return a dense string matrix with
 * empty rows dropped.
 *
 * It lives in `shared/` rather than under one feature because the leads import
 * and the service-catalogue import differ ONLY in how they interpret columns —
 * the bytes-to-matrix half is identical, and a second copy would be a second
 * xlsx reader to keep correct.
 */

/** Hard ceilings so a hostile file can't balloon memory (xlsx is zipped). */
export const MAX_PARSED_ROWS = 5_001; // header + 5000 rows (importLeads cap)
export const MAX_PARSED_COLS = 64;
const MAX_CELL_CHARS = 4_000;

export class SpreadsheetParseError extends Error {}

/**
 * Per-caller ceiling. `maxRows` counts the HEADER too, so a 5000-row import
 * passes 5001. `noun` only shapes the error text ("capped at 5000 leads" vs
 * "…services") — the user is being told which file to split.
 */
export interface ParseLimits {
  maxRows?: number;
  noun?: string;
}

function tooManyRows(limits: ParseLimits | undefined): SpreadsheetParseError {
  const maxRows = limits?.maxRows ?? MAX_PARSED_ROWS;
  const noun = limits?.noun ?? 'rows';
  return new SpreadsheetParseError(
    `Too many rows — a single import is capped at ${maxRows - 1} ${noun}. Split the file and try again.`
  );
}

function clampCell(value: string): string {
  return value.length > MAX_CELL_CHARS ? value.slice(0, MAX_CELL_CHARS) : value;
}

function isEmptyRow(row: string[]): boolean {
  return row.every((c) => c.trim().length === 0);
}

/** Count occurrences of a delimiter outside quoted sections. */
function countUnquoted(line: string, delim: string): number {
  let count = 0;
  let inQuotes = false;
  for (const ch of line) {
    if (ch === '"') inQuotes = !inQuotes;
    else if (ch === delim && !inQuotes) count++;
  }
  return count;
}

/** Pick the delimiter that appears most in the header line. Comma wins ties. */
function sniffDelimiter(text: string): string {
  const firstLine = text.slice(0, text.indexOf('\n') + 1 || text.length);
  let best = ',';
  let bestCount = countUnquoted(firstLine, ',');
  for (const delim of [';', '\t']) {
    const count = countUnquoted(firstLine, delim);
    if (count > bestCount) {
      best = delim;
      bestCount = count;
    }
  }
  return best;
}

/** RFC 4180 state machine — handles quoted fields, "" escapes, CR/LF/CRLF. */
export function parseCsv(input: string, limits?: ParseLimits): string[][] {
  const maxRows = limits?.maxRows ?? MAX_PARSED_ROWS;
  const text = input.replace(/^\uFEFF/, '');
  const delim = sniffDelimiter(text);

  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;

  const endField = () => {
    row.push(clampCell(field));
    field = '';
  };
  const endRow = () => {
    endField();
    if (!isEmptyRow(row)) {
      if (rows.length >= maxRows) throw tooManyRows(limits);
      if (row.length > MAX_PARSED_COLS) row.length = MAX_PARSED_COLS;
      rows.push(row);
    }
    row = [];
  };

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
    } else if (ch === '"' && field.length === 0) {
      inQuotes = true;
    } else if (ch === delim) {
      endField();
    } else if (ch === '\n') {
      endRow();
    } else if (ch === '\r') {
      if (text[i + 1] === '\n') i++;
      endRow();
    } else {
      field += ch;
    }
  }
  if (field.length > 0 || row.length > 0) endRow();

  return rows;
}

// ── xlsx ────────────────────────────────────────────────────────────────

const ZIP_MAGIC = [0x50, 0x4b, 0x03, 0x04]; // "PK\x03\x04"
const OLE_MAGIC = [0xd0, 0xcf, 0x11, 0xe0]; // legacy .xls / OLE compound file

export function looksLikeXlsx(bytes: Uint8Array): boolean {
  return ZIP_MAGIC.every((b, i) => bytes[i] === b);
}

export function looksLikeLegacyXls(bytes: Uint8Array): boolean {
  return OLE_MAGIC.every((b, i) => bytes[i] === b);
}

const xmlParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  // Keep every value a string — parsing "0876846467" to a number would drop
  // the leading zero, and we never want numeric coercion of cell text.
  parseTagValue: false,
  parseAttributeValue: false,
  trimValues: false,
});

function asArray<T>(value: T | T[] | undefined): T[] {
  if (value === undefined) return [];
  return Array.isArray(value) ? value : [value];
}

const decoder = new TextDecoder('utf-8');

function readEntry(
  files: Record<string, Uint8Array>,
  path: string
): string | null {
  const bytes = files[path];
  return bytes ? decoder.decode(bytes) : null;
}

/** "B3" → 1 (0-based column index). */
function refToColIndex(ref: string | undefined): number | null {
  if (!ref) return null;
  const letters = ref.match(/^[A-Z]+/i)?.[0];
  if (!letters) return null;
  let idx = 0;
  for (const ch of letters.toUpperCase()) {
    idx = idx * 26 + (ch.charCodeAt(0) - 64);
  }
  return idx - 1;
}

/** A shared/inline string entry: plain <t> or rich-text <r><t> runs. */
function textOfStringItem(item: unknown): string {
  if (item === null || item === undefined) return '';
  if (typeof item === 'string') return item;
  const obj = item as Record<string, unknown>;
  if (obj.t !== undefined) return textOfStringItem(obj.t);
  if (obj['#text'] !== undefined) return String(obj['#text']);
  if (obj.r !== undefined) {
    return asArray(obj.r)
      .map((run) => textOfStringItem(run))
      .join('');
  }
  return '';
}

interface XlsxCell {
  '@_r'?: string;
  '@_t'?: string;
  v?: unknown;
  is?: unknown;
}

function cellText(cell: XlsxCell, sharedStrings: string[]): string {
  const type = cell['@_t'] ?? 'n';
  if (type === 's') {
    const idx = Number(textOfStringItem(cell.v));
    return Number.isInteger(idx) ? (sharedStrings[idx] ?? '') : '';
  }
  if (type === 'inlineStr') return textOfStringItem(cell.is);
  if (type === 'b') return textOfStringItem(cell.v) === '1' ? 'TRUE' : 'FALSE';
  // 'str' (cached formula result), 'n' (number) and anything else: raw <v>.
  return textOfStringItem(cell.v);
}

/**
 * Parse the FIRST worksheet of an .xlsx workbook into a string matrix.
 * Throws SpreadsheetParseError on anything that doesn't look like a usable
 * workbook — callers turn that into a "save it as .csv" validation error.
 */
export function parseXlsx(bytes: Uint8Array, limits?: ParseLimits): string[][] {
  const maxRows = limits?.maxRows ?? MAX_PARSED_ROWS;
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(bytes);
  } catch {
    throw new SpreadsheetParseError('The .xlsx file could not be opened.');
  }

  // Resolve the first sheet in workbook order via the workbook relationships.
  const workbookXml = readEntry(files, 'xl/workbook.xml');
  if (!workbookXml) {
    throw new SpreadsheetParseError('The .xlsx file has no workbook.');
  }
  const workbook = xmlParser.parse(workbookXml) as {
    workbook?: { sheets?: { sheet?: unknown } };
  };
  const sheets = asArray(workbook.workbook?.sheets?.sheet) as Record<
    string,
    unknown
  >[];
  const firstSheet = sheets[0];
  if (!firstSheet) {
    throw new SpreadsheetParseError('The .xlsx workbook has no sheets.');
  }

  let sheetPath: string | null = null;
  const relsXml = readEntry(files, 'xl/_rels/workbook.xml.rels');
  if (relsXml) {
    const rels = xmlParser.parse(relsXml) as {
      Relationships?: { Relationship?: unknown };
    };
    const relId = firstSheet['@_r:id'];
    const rel = asArray(rels.Relationships?.Relationship).find(
      (r) => (r as Record<string, unknown>)['@_Id'] === relId
    ) as Record<string, unknown> | undefined;
    const target = rel?.['@_Target'];
    if (typeof target === 'string') {
      sheetPath = target.startsWith('/')
        ? target.slice(1)
        : `xl/${target.replace(/^\.\//, '')}`;
    }
  }
  if (!sheetPath || !files[sheetPath]) sheetPath = 'xl/worksheets/sheet1.xml';

  const sheetXml = readEntry(files, sheetPath);
  if (!sheetXml) {
    throw new SpreadsheetParseError('The .xlsx worksheet could not be read.');
  }

  const sharedStrings: string[] = [];
  const sharedXml = readEntry(files, 'xl/sharedStrings.xml');
  if (sharedXml) {
    const shared = xmlParser.parse(sharedXml) as {
      sst?: { si?: unknown };
    };
    for (const item of asArray(shared.sst?.si)) {
      sharedStrings.push(textOfStringItem(item));
    }
  }

  const sheet = xmlParser.parse(sheetXml) as {
    worksheet?: { sheetData?: { row?: unknown } };
  };
  const rows: string[][] = [];
  for (const rowNode of asArray(sheet.worksheet?.sheetData?.row)) {
    const cells = asArray((rowNode as Record<string, unknown>).c) as XlsxCell[];
    const row: string[] = [];
    for (let i = 0; i < cells.length; i++) {
      const col = refToColIndex(cells[i]['@_r']) ?? row.length;
      if (col >= MAX_PARSED_COLS) continue;
      while (row.length < col) row.push('');
      row[col] = clampCell(cellText(cells[i], sharedStrings));
    }
    if (isEmptyRow(row)) continue;
    if (rows.length >= maxRows) throw tooManyRows(limits);
    rows.push(row);
  }
  return rows;
}
