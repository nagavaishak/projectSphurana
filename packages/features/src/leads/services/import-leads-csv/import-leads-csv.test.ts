// `@borradh-workspace/ai` (and database/observability/env) are canonical
// alias mocks (vite.config.ts) — do NOT `vi.mock` them here; import the
// symbols and drive them with `vi.mocked()` (isolate:false maintenance rule).
import { chatCompletion, parseJsonResponse } from '@borradh-workspace/ai';
import { strToU8, zipSync } from 'fflate';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ErrorCodes } from '../../../shared/index.js';
import { importLeadsCsv } from './import-leads-csv.service.js';

const mockChat = vi.mocked(chatCompletion);
const mockParseJson = vi.mocked(parseJsonResponse);

const ORG = '550e8400-e29b-41d4-a716-446655440000';

function makeDb() {
  return {
    insert: vi.fn().mockReturnThis(),
    values: vi.fn().mockResolvedValue(undefined),
    query: { lead: { findMany: vi.fn().mockResolvedValue([]) } },
  };
}

const baseInput = {
  organizationId: ORG,
  deduplicateBy: 'email',
  onDuplicate: 'skip',
  consentAcknowledgment: true,
} as const;

/** The lead rows handed to the db insert (first batch). */
function insertedRows(db: ReturnType<typeof makeDb>) {
  return db.values.mock.calls[0][0] as Record<string, unknown>[];
}

describe('importLeadsCsv', () => {
  beforeEach(() => vi.clearAllMocks());

  it('rejects an empty csv', async () => {
    const result = await importLeadsCsv(makeDb() as never, {
      ...baseInput,
      csv: '',
    });
    expect(result.success).toBe(false);
    if (!result.success)
      expect(result.error.code).toBe(ErrorCodes.VALIDATION_ERROR);
    expect(mockChat).not.toHaveBeenCalled();
  });

  it('rejects a request with neither csv nor file', async () => {
    const result = await importLeadsCsv(makeDb() as never, { ...baseInput });
    expect(result.success).toBe(false);
    if (!result.success)
      expect(result.error.code).toBe(ErrorCodes.VALIDATION_ERROR);
  });

  it('rejects a csv over 1 MB', async () => {
    const result = await importLeadsCsv(makeDb() as never, {
      ...baseInput,
      csv: `name,email\n${'x'.repeat(1_100_000)}`,
    });
    expect(result.success).toBe(false);
    if (!result.success)
      expect(result.error.code).toBe(ErrorCodes.VALIDATION_ERROR);
  });

  it('rejects a csv with only a header row', async () => {
    const result = await importLeadsCsv(makeDb() as never, {
      ...baseInput,
      csv: 'name,email\n',
    });
    expect(result.success).toBe(false);
    if (!result.success)
      expect(result.error.code).toBe(ErrorCodes.VALIDATION_ERROR);
  });

  it('imports a well-labelled csv without any AI call', async () => {
    const db = makeDb();
    const result = await importLeadsCsv(db as never, {
      ...baseInput,
      csv: '﻿First Name,Surname,Email,Mobile\r\nSarah,Murphy,sarah@example.ie,087 684 6467\r\nLiam,,liam@example.ie,\r\n',
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.imported).toBe(2);
      expect(result.data.rowsInFile).toBe(2);
      expect(result.data.cleanedRows).toBe(2);
      expect(result.data.skippedRows).toBe(0);
      expect(result.data.failedChunks).toBe(0);
      expect(result.data.columnMapping).toEqual({
        'First Name': 'firstName',
        Surname: 'lastName',
        Email: 'email',
        Mobile: 'phone',
      });
    }
    expect(mockChat).not.toHaveBeenCalled();
    expect(insertedRows(db)[0]).toMatchObject({
      firstName: 'Sarah',
      lastName: 'Murphy',
      email: 'sarah@example.ie',
      phone: '087 684 6467',
    });
  });

  it('splits full names, keeps quoted commas, and lands extra columns in notes', async () => {
    const db = makeDb();
    const result = await importLeadsCsv(db as never, {
      ...baseInput,
      csv: 'Name,Email,Clinic\n"O\'Brien, Mary Jane",mary@example.ie,"Acme, Dublin"\n',
    });

    expect(result.success).toBe(true);
    // Quoted "O'Brien, Mary Jane" stays one cell and is read as Last, First;
    // the unmapped Clinic column is preserved as a note line.
    expect(insertedRows(db)[0]).toMatchObject({
      firstName: 'Mary Jane',
      lastName: "O'Brien",
      email: 'mary@example.ie',
      notes: 'Clinic: Acme, Dublin',
    });
  });

  it('asks the AI to identify unknown headers, then imports', async () => {
    const mapping = { '0': 'firstName', '1': 'email', '2': 'phone' };
    mockChat.mockResolvedValueOnce({
      content: JSON.stringify({ mapping }),
      finishReason: 'stop',
    } as never);
    mockParseJson.mockReturnValueOnce({
      success: true,
      data: { mapping },
      raw: '',
    } as never);

    const db = makeDb();
    const result = await importLeadsCsv(db as never, {
      ...baseInput,
      csv: 'Vorname,Mailadresse,Handynummer\nAnna,anna@example.de,+49151111111\n',
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.imported).toBe(1);
      expect(result.data.columnMapping).toEqual({
        Vorname: 'firstName',
        Mailadresse: 'email',
        Handynummer: 'phone',
      });
    }
    expect(mockChat).toHaveBeenCalledTimes(1);
  });

  it('still imports when the AI mapping call fails', async () => {
    mockChat.mockRejectedValueOnce(new Error('model down'));

    const db = makeDb();
    const result = await importLeadsCsv(db as never, {
      ...baseInput,
      csv: 'Vorname,Email\nAnna,anna@example.de\n',
    });

    expect(result.success).toBe(true);
    if (result.success) expect(result.data.imported).toBe(1);
    // The unknown Vorname column is preserved as a note, not dropped.
    expect(insertedRows(db)[0]).toMatchObject({
      email: 'anna@example.de',
      notes: 'Vorname: Anna',
    });
  });

  it('returns VALIDATION_ERROR when no lead columns can be identified', async () => {
    const mapping = { '0': 'ignore', '1': 'ignore' };
    mockChat.mockResolvedValueOnce({
      content: JSON.stringify({ mapping }),
      finishReason: 'stop',
    } as never);
    mockParseJson.mockReturnValueOnce({
      success: true,
      data: { mapping },
      raw: '',
    } as never);

    const result = await importLeadsCsv(makeDb() as never, {
      ...baseInput,
      csv: 'Ref,Paid\n41,yes\n42,no\n',
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.VALIDATION_ERROR);
      expect(result.error.message).toContain('Could not recognise');
    }
  });

  it('rejects imports above the row cap', async () => {
    const rows = Array.from(
      { length: 5_001 },
      (_, i) => `Ana${i},a${i}@example.ie`
    ).join('\n');
    const result = await importLeadsCsv(makeDb() as never, {
      ...baseInput,
      csv: `Name,Email\n${rows}\n`,
    });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.message).toMatch(/too many rows/i);
  });

  it('imports an .xlsx upload', async () => {
    const sheet = `<?xml version="1.0"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>
  <row r="1"><c r="A1" t="inlineStr"><is><t>Full Name</t></is></c><c r="B1" t="inlineStr"><is><t>Email Address</t></is></c></row>
  <row r="2"><c r="A2" t="inlineStr"><is><t>Sarah Murphy</t></is></c><c r="B2" t="inlineStr"><is><t>sarah@example.ie</t></is></c></row>
</sheetData></worksheet>`;
    const workbook = `<?xml version="1.0"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="S1" sheetId="1" r:id="rId1"/></sheets></workbook>`;
    const xlsx = zipSync({
      'xl/workbook.xml': strToU8(workbook),
      'xl/worksheets/sheet1.xml': strToU8(sheet),
    });

    const db = makeDb();
    const result = await importLeadsCsv(db as never, {
      ...baseInput,
      fileBase64: Buffer.from(xlsx).toString('base64'),
      fileName: 'leads.xlsx',
    });

    expect(result.success).toBe(true);
    if (result.success) expect(result.data.imported).toBe(1);
    expect(insertedRows(db)[0]).toMatchObject({
      firstName: 'Sarah',
      lastName: 'Murphy',
      email: 'sarah@example.ie',
    });
    expect(mockChat).not.toHaveBeenCalled();
  });

  it('rejects legacy .xls files with a clear message', async () => {
    const ole = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
    const result = await importLeadsCsv(makeDb() as never, {
      ...baseInput,
      fileBase64: ole.toString('base64'),
      fileName: 'leads.xls',
    });
    expect(result.success).toBe(false);
    if (!result.success)
      expect(result.error.message).toContain('.xls files are not supported');
  });

  it('turns an unreadable xlsx into a VALIDATION_ERROR', async () => {
    // Valid zip magic, but not a workbook.
    const zip = zipSync({ 'not-excel.txt': strToU8('hello') });
    const result = await importLeadsCsv(makeDb() as never, {
      ...baseInput,
      fileBase64: Buffer.from(zip).toString('base64'),
      fileName: 'leads.xlsx',
    });
    expect(result.success).toBe(false);
    if (!result.success)
      expect(result.error.code).toBe(ErrorCodes.VALIDATION_ERROR);
  });
});
