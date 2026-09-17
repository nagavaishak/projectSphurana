// `@borradh-workspace/ai` (and database/observability/env) are canonical
// alias mocks (vite.config.ts) — do NOT `vi.mock` them here; import the
// symbols and drive them with `vi.mocked()` (isolate:false maintenance rule).
import { chatCompletion, parseJsonResponse } from '@borradh-workspace/ai';
import { strToU8, zipSync } from 'fflate';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ErrorCodes } from '../../../shared/index.js';
import { importServicesCsv } from './import-services-csv.service.js';

const mockChat = vi.mocked(chatCompletion);
const mockParseJson = vi.mocked(parseJsonResponse);

const ORG = '550e8400-e29b-41d4-a716-446655440000';

interface Row {
  id: string;
  name: string;
  [key: string]: unknown;
}

/**
 * A db double that behaves like the real thing for the three writes this
 * import performs: the catalogue read, `createService`'s read-then-insert, and
 * `createCategory`'s. Inserted rows are echoed back with an id so the service's
 * own "already imported this name" bookkeeping is exercised for real.
 */
function makeDb(options?: {
  existingServices?: Row[];
  categories?: Row[];
  /**
   * What `organizationService.findFirst` resolves to. `createService` uses it
   * as a uniqueness PRE-CHECK (must be undefined, or every row is a
   * duplicate), while `updateService` uses it as an existence check (must be
   * the row, or the update is NOT_FOUND). Only one of the two runs per test.
   */
  findFirstResult?: Row;
}) {
  const services: Row[] = [...(options?.existingServices ?? [])];
  const categories: Row[] = [...(options?.categories ?? [])];
  const inserted: Record<string, unknown>[] = [];
  const updated: Record<string, unknown>[] = [];

  let seq = 0;
  let mode: 'insert' | 'update' = 'insert';
  let pendingValues: Record<string, unknown> = {};

  const chain = {
    values: vi.fn((v: Record<string, unknown>) => {
      pendingValues = v;
      return chain;
    }),
    set: vi.fn((v: Record<string, unknown>) => {
      pendingValues = v;
      return chain;
    }),
    where: vi.fn(() => chain),
    returning: vi.fn(async () => {
      const row = { id: `id-${++seq}`, ...pendingValues } as Row;
      if (mode === 'update') {
        updated.push(pendingValues);
        // `priceType` is only ever on a SERVICE write — a category insert has
        // no pricing at all — so it is the cheapest way to tell the two
        // tables apart without reaching into the drizzle table object.
      } else if ('priceType' in pendingValues) {
        inserted.push(pendingValues);
        services.push(row);
      } else {
        categories.push(row);
      }
      return [row];
    }),
  };

  const db = {
    insert: vi.fn(() => {
      mode = 'insert';
      return chain;
    }),
    update: vi.fn(() => {
      mode = 'update';
      return chain;
    }),
    query: {
      organizationService: {
        findMany: vi.fn(async () => services),
        findFirst: vi.fn(async () => options?.findFirstResult),
      },
      organizationServiceCategory: {
        findMany: vi.fn(async () => categories),
        findFirst: vi.fn(async () => undefined),
      },
    },
    inserted,
    updated,
    categories,
  };
  return db;
}

const baseInput = {
  organizationId: ORG,
  onDuplicate: 'skip',
  createMissingCategories: false,
  importAsInactive: false,
} as const;

/** A minimal single-sheet .xlsx holding the given matrix, as base64. */
function xlsxBase64(matrix: string[][]): string {
  const rows = matrix
    .map(
      (cells, r) =>
        `<row r="${r + 1}">${cells
          .map(
            (c, i) =>
              `<c r="${String.fromCharCode(65 + i)}${r + 1}" t="inlineStr"><is><t>${c}</t></is></c>`
          )
          .join('')}</row>`
    )
    .join('');
  const zip = zipSync({
    'xl/workbook.xml': strToU8(
      '<workbook><sheets><sheet name="Sheet1" sheetId="1" r:id="rId1"/></sheets></workbook>'
    ),
    'xl/worksheets/sheet1.xml': strToU8(
      `<worksheet><sheetData>${rows}</sheetData></worksheet>`
    ),
  });
  return Buffer.from(zip).toString('base64');
}

describe('importServicesCsv', () => {
  beforeEach(() => vi.clearAllMocks());

  it('rejects a request with neither csv nor file', async () => {
    const result = await importServicesCsv(makeDb() as never, {
      ...baseInput,
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.VALIDATION_ERROR);
    }
    expect(mockChat).not.toHaveBeenCalled();
  });

  it('rejects a file with only a header row', async () => {
    const result = await importServicesCsv(makeDb() as never, {
      ...baseInput,
      csv: 'Service,Price',
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.message).toMatch(/header row/i);
    }
  });

  it('imports services and maps price, duration and columns deterministically', async () => {
    const db = makeDb();
    const result = await importServicesCsv(db as never, {
      ...baseInput,
      csv: [
        'Service,Price,Duration',
        'Deluxe Facial,€85,60 min',
        'Consultation,Free,15',
      ].join('\n'),
    });

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.imported).toBe(2);
    expect(result.data.rowsInFile).toBe(2);
    expect(result.data.columnMapping).toEqual({
      Service: 'name',
      Price: 'price',
      Duration: 'duration',
    });

    expect(db.inserted[0]).toMatchObject({
      name: 'Deluxe Facial',
      priceType: 'fixed',
      priceCents: 8500,
      appointmentDuration: 60,
      isActive: true,
    });
    // `free` never carries a number — createService normalises it to null.
    expect(db.inserted[1]).toMatchObject({
      name: 'Consultation',
      priceType: 'free',
      priceCents: null,
      appointmentDuration: 15,
    });

    // Every header resolved, so there was nothing to ask the model about.
    expect(mockChat).not.toHaveBeenCalled();
  });

  it('reads an .xlsx upload', async () => {
    const db = makeDb();
    const result = await importServicesCsv(db as never, {
      ...baseInput,
      fileBase64: xlsxBase64([
        ['Service', 'Price'],
        ['Peel', '120'],
      ]),
      fileName: 'catalogue.xlsx',
    });

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.imported).toBe(1);
    expect(db.inserted[0]).toMatchObject({ name: 'Peel', priceCents: 12_000 });
  });

  it('skips a row whose service already exists', async () => {
    const db = makeDb({
      existingServices: [{ id: 'svc-1', name: 'Deluxe Facial' }],
    });
    const result = await importServicesCsv(db as never, {
      ...baseInput,
      csv: 'Service,Price\nDeluxe Facial,85\nNew Thing,50',
    });

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.skipped).toBe(1);
    expect(result.data.imported).toBe(1);
    expect(db.inserted).toHaveLength(1);
    expect(db.inserted[0]).toMatchObject({ name: 'New Thing' });
  });

  it('matches an existing service case-insensitively', async () => {
    const db = makeDb({
      existingServices: [{ id: 'svc-1', name: 'Deluxe Facial' }],
    });
    const result = await importServicesCsv(db as never, {
      ...baseInput,
      csv: 'Service,Price\ndeluxe  facial,85',
    });
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.skipped).toBe(1);
    expect(result.data.imported).toBe(0);
  });

  it('updates an existing service when asked to', async () => {
    const existing = { id: 'svc-1', name: 'Deluxe Facial' };
    const db = makeDb({
      existingServices: [existing],
      findFirstResult: existing,
    });
    const result = await importServicesCsv(db as never, {
      ...baseInput,
      onDuplicate: 'update',
      csv: 'Service,Price\nDeluxe Facial,99',
    });

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.updated).toBe(1);
    expect(result.data.skipped).toBe(0);
  });

  it('does not fail the second row when a file lists the same service twice', async () => {
    const db = makeDb();
    const result = await importServicesCsv(db as never, {
      ...baseInput,
      csv: 'Service,Price\nPeel,50\nPeel,50',
    });

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.imported).toBe(1);
    expect(result.data.skipped).toBe(1);
    expect(result.data.errors).toEqual([]);
  });

  it('files services under an existing category, matched by name', async () => {
    const db = makeDb({
      categories: [{ id: 'cat-1', name: 'Facials' }],
    });
    const result = await importServicesCsv(db as never, {
      ...baseInput,
      csv: 'Service,Category\nDeluxe Facial,facials',
    });

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.categoriesCreated).toBe(0);
    expect(db.inserted[0]).toMatchObject({ categoryId: 'cat-1' });
  });

  it('creates missing categories only when asked to', async () => {
    const withoutCreate = makeDb();
    const a = await importServicesCsv(withoutCreate as never, {
      ...baseInput,
      csv: 'Service,Category\nDeluxe Facial,Facials',
    });
    expect(a.success).toBe(true);
    if (!a.success) return;
    expect(a.data.categoriesCreated).toBe(0);
    expect(withoutCreate.inserted[0]).toMatchObject({ categoryId: null });

    const withCreate = makeDb();
    const b = await importServicesCsv(withCreate as never, {
      ...baseInput,
      createMissingCategories: true,
      csv: 'Service,Category\nDeluxe Facial,Facials',
    });
    expect(b.success).toBe(true);
    if (!b.success) return;
    expect(b.data.categoriesCreated).toBe(1);
    expect(withCreate.categories[0]).toMatchObject({ name: 'Facials' });
  });

  it('imports as inactive when asked to', async () => {
    const db = makeDb();
    await importServicesCsv(db as never, {
      ...baseInput,
      importAsInactive: true,
      csv: 'Service,Price\nPeel,50',
    });
    expect(db.inserted[0]).toMatchObject({ isActive: false });
  });

  it('counts rows dropped for having no service name', async () => {
    const db = makeDb();
    const result = await importServicesCsv(db as never, {
      ...baseInput,
      csv: 'Service,Price\nPeel,50\n,99',
    });
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.rowsInFile).toBe(2);
    expect(result.data.cleanedRows).toBe(1);
    expect(result.data.skippedRows).toBe(1);
  });

  it('fails with a readable message when no column is a service name', async () => {
    mockChat.mockResolvedValue({ content: '{"mapping":{}}' } as never);
    mockParseJson.mockReturnValue({
      success: true,
      data: { mapping: {} },
    } as never);

    const result = await importServicesCsv(makeDb() as never, {
      ...baseInput,
      csv: 'Xyzzy,Plugh\na,b',
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.VALIDATION_ERROR);
      expect(result.error.message).toMatch(/could not recognise/i);
    }
  });

  it('asks the model only about columns the synonym table could not place', async () => {
    mockChat.mockResolvedValue({
      content: '{"mapping":{"1":"duration"}}',
    } as never);
    mockParseJson.mockReturnValue({
      success: true,
      data: { mapping: { '1': 'duration' } },
    } as never);

    const db = makeDb();
    const result = await importServicesCsv(db as never, {
      ...baseInput,
      csv: 'Service,Slot length\nPeel,45',
    });

    expect(mockChat).toHaveBeenCalledTimes(1);
    const [prompt, opts] = mockChat.mock.calls[0];
    expect(prompt).toContain('UNRESOLVED');
    expect(prompt).toContain('Slot length');
    // The model that actually runs this — cheap tier, gpt-5.6-luna.
    expect(opts).toMatchObject({ model: 'gpt-5.6-luna', temperature: 0 });

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(db.inserted[0]).toMatchObject({ appointmentDuration: 45 });
  });

  it('never lets the model re-point a column the heuristics resolved', async () => {
    mockChat.mockResolvedValue({ content: '{}' } as never);
    mockParseJson.mockReturnValue({
      success: true,
      // Column 0 is already `name`; the model must not steal it.
      data: { mapping: { '0': 'price', '1': 'name' } },
    } as never);

    const db = makeDb();
    await importServicesCsv(db as never, {
      ...baseInput,
      csv: 'Service,Mystery\nPeel,Whatever',
    });

    expect(db.inserted[0]).toMatchObject({ name: 'Peel' });
  });

  it('imports fine when the AI call fails', async () => {
    mockChat.mockRejectedValue(new Error('model down'));

    const db = makeDb();
    const result = await importServicesCsv(db as never, {
      ...baseInput,
      csv: 'Service,Mystery\nPeel,Whatever',
    });

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.imported).toBe(1);
    // The unmapped column is preserved rather than dropped.
    expect(db.inserted[0]).toMatchObject({
      name: 'Peel',
      description: 'Mystery: Whatever',
    });
  });
});
