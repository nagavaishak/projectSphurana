/**
 * INTEGRATION — POST /organization-services/import-csv
 * (`packages/features/src/organization-services/services/import-services-csv/`).
 *
 * REAL: HTTP pipeline, ValidationPipe, RoleGuard + @RequireRole('admin'), the
 * feature service, the shared spreadsheet parser, `createService`/`updateService`,
 * the `organization_service_name_unique` constraint and SQL. Every assertion
 * READS THE ROW BACK FROM POSTGRES rather than trusting the response summary —
 * the summary saying "9 added" is not evidence that nine usable services exist.
 * FAKED: AuthGuard only.
 *
 * WHY THIS FILE EXISTS
 * The unit tests already cover the mapping table and the coercions with a mock
 * db. What they cannot see is the half of this feature that only exists once a
 * real database is involved: that `price_type`/`price_cents` land in a legal
 * combination, that a duplicate name meets the unique constraint instead of
 * racing it, that categories are resolved against rows another org can also
 * own, and that a non-admin is stopped before any of it runs.
 *
 * THE MODEL IS STUBBED, NOT DISABLED.
 * Blanking `OPENAI_API_KEY` here does NOT work: the service reads
 * `apiEnv.OPENAI_API_KEY` off a validated env object built at import time, and
 * imports are hoisted above any assignment in this file. The first version of
 * this suite did exactly that and silently ran against LIVE OpenAI — which
 * meant it behaved one way locally (root `.env` has a key) and another in CI
 * (`INT_SKIP_ROOT_ENV=1`, no key), i.e. it measured the weather.
 *
 * So `@borradh-workspace/ai` is stubbed instead. By default `chatCompletion`
 * throws, which drives the documented fallback — any AI failure returns null
 * and the import proceeds on the synonym table alone. Tests that care about
 * the assist path set `mockAiState.mapping` and get a deterministic answer,
 * which is the only way to pin what happens when the model returns something
 * DESTRUCTIVE. That is not a hypothetical: a live model asked to place a
 * second price column answers `ignore`, and before the fix in
 * `map-service-columns.ts` that deleted the column.
 */
import {
  db,
  organizationService,
  organizationServiceCategory,
} from '@borradh-workspace/database';
import { and, eq } from 'drizzle-orm';
import { strToU8, zipSync } from 'fflate';
import request from 'supertest';

import { OrganizationServicesController } from '../organization-services/organization-services.controller.js';
import {
  type IntegrationApp,
  buildControllerApp,
  seedOrgWithMember,
  seedService,
} from './harness.js';

const CREATED = 201;
const BAD_REQUEST = 400;
const FORBIDDEN = 403;

const IMPORT_PATH = '/organization-services/import-csv';

/**
 * What the stubbed model answers. `null` makes the call throw, which is the
 * "no AI available / AI failed" path every test gets unless it opts in.
 * Must be `mock`-prefixed — jest hoists the factory above this file's imports
 * and refuses out-of-scope references otherwise.
 */
const mockAiState: { mapping: Record<string, string> | null } = {
  mapping: null,
};

jest.mock('@borradh-workspace/ai', () => {
  const actual = jest.requireActual('@borradh-workspace/ai');
  return {
    ...actual,
    // Pretend a client exists so `ensureAIClientAvailable()` never consults a
    // real key — the stub below is what answers, in CI and locally alike.
    isAIClientInitialized: () => true,
    initAIClient: () => undefined,
    chatCompletion: async () => {
      if (!mockAiState.mapping) {
        throw new Error('stubbed AI failure');
      }
      return { content: JSON.stringify({ mapping: mockAiState.mapping }) };
    },
  };
});

beforeEach(() => {
  mockAiState.mapping = null;
});

/* ------------------------------------------------------------------ */
/* Fixtures                                                            */
/* ------------------------------------------------------------------ */

/**
 * A catalogue export shaped like the ones clinics actually arrive with
 * (Fresha / Phorest / Timely): the header wording is theirs, not ours, and the
 * price and duration columns are free text rather than numbers.
 */
const REALISTIC_CSV = [
  'Service name,Category,Duration (mins),Price incl. VAT,Description,Notes',
  'Signature Glow Facial,Facials,60,€85,Deep cleanse and mask.,Best seller',
  'Dermal Filler - 1ml,Injectables,45,From €250,Restores lost volume.,',
  'Skin Consultation,Consultations,15,Free,Fifteen-minute assessment.,',
  'Laser Hair Removal,Laser,1h 30m,"€1,250.00",Course of six sessions.,',
  'Microneedling,Skin,90 minutes,POA,Collagen induction therapy.,',
  'Lip Flip,Injectables,0:30,£85.50,A subtle lift.,',
  'Medium Peel,Skin,45,€120–€180,Medium-depth peel.,Varies by strength',
  'Full Body Massage,Wellness,1.5 hours,95,Relaxation massage.,',
].join('\n');

/** What every row of {@link REALISTIC_CSV} must look like once persisted. */
const EXPECTED_ROWS = [
  {
    name: 'Signature Glow Facial',
    priceType: 'fixed',
    priceCents: 8500,
    appointmentDuration: 60,
    category: 'Facials',
  },
  {
    name: 'Dermal Filler - 1ml',
    priceType: 'from',
    priceCents: 25000,
    appointmentDuration: 45,
    category: 'Injectables',
  },
  {
    name: 'Skin Consultation',
    priceType: 'free',
    priceCents: null,
    appointmentDuration: 15,
    category: 'Consultations',
  },
  {
    name: 'Laser Hair Removal',
    priceType: 'fixed',
    priceCents: 125000,
    appointmentDuration: 90,
    category: 'Laser',
  },
  {
    name: 'Microneedling',
    priceType: 'poa',
    priceCents: null,
    appointmentDuration: 90,
    category: 'Skin',
  },
  {
    name: 'Lip Flip',
    priceType: 'fixed',
    priceCents: 8550,
    appointmentDuration: 30,
    category: 'Injectables',
  },
  {
    name: 'Medium Peel',
    priceType: 'from',
    priceCents: 12000,
    appointmentDuration: 45,
    category: 'Skin',
  },
  {
    name: 'Full Body Massage',
    priceType: 'fixed',
    priceCents: 9500,
    appointmentDuration: 90,
    category: 'Wellness',
  },
] as const;

/**
 * Build a workbook the way Excel/Numbers/Fresha actually write one: a
 * `sharedStrings.xml` table for text and bare numeric `<v>` cells for numbers.
 *
 * The dialog's own fixtures were hand-built with `inlineStr` cells, which is a
 * DIFFERENT branch of `cellText()`. An .xlsx test that only exercises inline
 * strings proves nothing about the files customers upload.
 */
function buildXlsx(rows: string[][]): Buffer {
  const strings: string[] = [];
  const internStr = (value: string): number => {
    const existing = strings.indexOf(value);
    if (existing !== -1) return existing;
    return strings.push(value) - 1;
  };

  const colName = (index: number): string => {
    let n = index + 1;
    let out = '';
    while (n > 0) {
      const rem = (n - 1) % 26;
      out = String.fromCharCode(65 + rem) + out;
      n = Math.floor((n - 1) / 26);
    }
    return out;
  };

  const esc = (value: string) =>
    value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

  const sheetRows = rows
    .map((row, r) => {
      const cells = row
        .map((value, c) => {
          const ref = `${colName(c)}${r + 1}`;
          // A bare number goes in as a number, exactly as a spreadsheet would
          // write it — no `t` attribute, raw <v>.
          if (value !== '' && /^-?\d+(\.\d+)?$/.test(value)) {
            return `<c r="${ref}"><v>${value}</v></c>`;
          }
          return `<c r="${ref}" t="s"><v>${internStr(value)}</v></c>`;
        })
        .join('');
      return `<row r="${r + 1}">${cells}</row>`;
    })
    .join('');

  const sharedStrings = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="${strings.length}" uniqueCount="${strings.length}">${strings
    .map((s) => `<si><t>${esc(s)}</t></si>`)
    .join('')}</sst>`;

  return Buffer.from(
    zipSync({
      '[Content_Types].xml': strToU8(
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/></Types>'
      ),
      '_rels/.rels': strToU8(
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>'
      ),
      'xl/workbook.xml': strToU8(
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Services" sheetId="1" r:id="rId1"/></sheets></workbook>'
      ),
      'xl/_rels/workbook.xml.rels': strToU8(
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings" Target="sharedStrings.xml"/></Relationships>'
      ),
      'xl/sharedStrings.xml': strToU8(sharedStrings),
      'xl/worksheets/sheet1.xml': strToU8(
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${sheetRows}</sheetData></worksheet>`
      ),
    })
  );
}

/* ------------------------------------------------------------------ */
/* Read-back helpers                                                   */
/* ------------------------------------------------------------------ */

const servicesOf = async (organizationId: string) =>
  db.query.organizationService.findMany({
    where: eq(organizationService.organizationId, organizationId),
  });

const serviceNamed = async (organizationId: string, name: string) =>
  db.query.organizationService.findFirst({
    where: and(
      eq(organizationService.organizationId, organizationId),
      eq(organizationService.name, name)
    ),
  });

const categoriesOf = async (organizationId: string) =>
  db.query.organizationServiceCategory.findMany({
    where: eq(organizationServiceCategory.organizationId, organizationId),
  });

/** Build the app as an ADMIN of a fresh org — the role the route requires. */
async function adminApp(): Promise<{
  h: IntegrationApp;
  organizationId: string;
  userId: string;
}> {
  const admin = await seedOrgWithMember('admin');
  const h = await buildControllerApp(OrganizationServicesController, {
    userId: admin.userId,
    organizationId: admin.organizationId,
  });
  return { h, organizationId: admin.organizationId, userId: admin.userId };
}

/* ------------------------------------------------------------------ */

describe('INTEGRATION — POST /organization-services/import-csv', () => {
  describe('the round trip', () => {
    it('persists a realistic export with every price and duration coercion intact', async () => {
      // The single most important test in this file. Each of these cells is a
      // shape a real export uses, and each one has a way of going wrong that is
      // invisible in the summary: "€1,250.00" read as €1.25 would still import
      // "successfully", and a dropped duration would still count as imported.
      const { h, organizationId } = await adminApp();
      try {
        const res = await request(h.app.getHttpServer())
          .post(IMPORT_PATH)
          .send({ csv: REALISTIC_CSV, fileName: 'export.csv' });

        expect(res.status).toBe(CREATED);
        expect(res.body).toMatchObject({
          imported: EXPECTED_ROWS.length,
          skipped: 0,
          updated: 0,
          errors: [],
          rowsInFile: EXPECTED_ROWS.length,
        });

        const categories = await categoriesOf(organizationId);
        const categoryById = new Map(categories.map((c) => [c.id, c.name]));

        for (const expected of EXPECTED_ROWS) {
          const row = await serviceNamed(organizationId, expected.name);
          expect(row).toBeDefined();
          expect({
            name: row?.name,
            priceType: row?.priceType,
            priceCents: row?.priceCents,
            appointmentDuration: row?.appointmentDuration,
            category: row?.categoryId
              ? categoryById.get(row.categoryId)
              : undefined,
          }).toEqual({
            name: expected.name,
            priceType: expected.priceType,
            priceCents: expected.priceCents,
            appointmentDuration: expected.appointmentDuration,
            category: expected.category,
          });
        }
      } finally {
        await h.close();
      }
    });

    it('never stores a price NUMBER alongside a free or POA price type', async () => {
      // The shape the rest of the product relies on: a `free`/`poa` service
      // must not carry cents, or the booking UI will render "Free — €85".
      const { h, organizationId } = await adminApp();
      try {
        await request(h.app.getHttpServer())
          .post(IMPORT_PATH)
          .send({
            csv: [
              'Service,Price,Duration',
              'Consult,Free,15',
              'Bespoke plan,On request,45',
            ].join('\n'),
          })
          .expect(CREATED);

        const rows = await servicesOf(organizationId);
        for (const row of rows) {
          if (row.priceType === 'free' || row.priceType === 'poa') {
            expect(row.priceCents).toBeNull();
          }
        }
        expect(rows.map((r) => r.priceType).sort()).toEqual(['free', 'poa']);
      } finally {
        await h.close();
      }
    });

    it('an .xlsx written the way Excel writes one imports identically to the CSV', async () => {
      // Shared-strings text + bare numeric cells, NOT the inline strings a
      // hand-built fixture defaults to. This is the branch customer files take.
      const { h, organizationId } = await adminApp();
      try {
        const xlsx = buildXlsx([
          ['Service name', 'Category', 'Duration (mins)', 'Price incl. VAT'],
          ['Deluxe Hydrafacial', 'Facials', '75', '145'],
          ['Dermaplaning', 'Skin', '45', '120'],
        ]);

        await request(h.app.getHttpServer())
          .post(IMPORT_PATH)
          .send({
            fileBase64: xlsx.toString('base64'),
            fileName: 'export.xlsx',
          })
          .expect(CREATED);

        const hydra = await serviceNamed(organizationId, 'Deluxe Hydrafacial');
        expect(hydra?.priceType).toBe('fixed');
        expect(hydra?.priceCents).toBe(14500);
        expect(hydra?.appointmentDuration).toBe(75);

        const derma = await serviceNamed(organizationId, 'Dermaplaning');
        expect(derma?.priceCents).toBe(12000);
        expect(derma?.appointmentDuration).toBe(45);
      } finally {
        await h.close();
      }
    });
  });

  describe('no data is silently discarded', () => {
    it('keeps a column it cannot place, as a labelled line in the description', async () => {
      // The invariant that makes a bad mapping RECOVERABLE instead of
      // destructive. If "Room turnaround" is not a field we model, the clinic
      // must still be able to find the number afterwards — the failure mode to
      // prevent is an import that looks like it worked and quietly lost a
      // column. Note this runs with no AI available, which is exactly when
      // unknown headers are most likely to go unplaced.
      const { h, organizationId } = await adminApp();
      try {
        await request(h.app.getHttpServer())
          .post(IMPORT_PATH)
          .send({
            csv: [
              'Service,Price,Room turnaround,Practitioner tier',
              'Thread Lift,€600,20 mins,Senior',
            ].join('\n'),
          })
          .expect(CREATED);

        const row = await serviceNamed(organizationId, 'Thread Lift');
        expect(row?.priceCents).toBe(60000);
        expect(row?.description).toContain('Room turnaround: 20 mins');
        expect(row?.description).toContain('Practitioner tier: Senior');
      } finally {
        await h.close();
      }
    });

    it('demotes unreadable price and duration text instead of inventing values', async () => {
      // "all day" must NOT become 480 minutes and "ask reception" must NOT
      // become €0 — a wrong appointment length is worse than a missing one,
      // because nothing about it looks wrong on the screen.
      const { h, organizationId } = await adminApp();
      try {
        await request(h.app.getHttpServer())
          .post(IMPORT_PATH)
          .send({
            csv: [
              'Service name,Duration (mins),Price incl. VAT',
              'Brow Shape and Tint,all day,ask reception',
            ].join('\n'),
          })
          .expect(CREATED);

        const row = await serviceNamed(organizationId, 'Brow Shape and Tint');
        expect(row?.appointmentDuration).toBeNull();
        expect(row?.priceCents).toBeNull();
        expect(row?.description).toContain('Duration (mins): all day');
        expect(row?.description).toContain('Price incl. VAT: ask reception');
      } finally {
        await h.close();
      }
    });

    it('takes the FIRST price column when an export carries several, and KEEPS the rest', async () => {
      // Catalogue exports routinely ship "Price", "Member price" and
      // "Price ex VAT" side by side. Letting the last column win would reprice
      // the whole catalogue on import — silently, and in the customer's favour
      // exactly never. But dropping them is the other failure, and it is the
      // one that actually shipped: duplicates used to map to `null`, `null`
      // meant "ask the model", and the model answered `ignore`.
      const { h, organizationId } = await adminApp();
      try {
        await request(h.app.getHttpServer())
          .post(IMPORT_PATH)
          .send({
            csv: [
              'Service name,Price,Member price,Price ex VAT',
              'Signature Facial,€120,€90,€97.56',
            ].join('\n'),
          })
          .expect(CREATED);

        const row = await serviceNamed(organizationId, 'Signature Facial');
        expect(row?.priceType).toBe('fixed');
        expect(row?.priceCents).toBe(12000);
        expect(row?.description).toContain('Member price: €90');
        expect(row?.description).toContain('Price ex VAT: €97.56');
      } finally {
        await h.close();
      }
    });

    it('a model that answers "ignore" cannot delete a duplicate column', async () => {
      // The exact live-model answer that caused the bug, now pinned. The
      // heuristics resolve these to notes BEFORE the assist runs, so they are
      // never offered to the model — its `ignore` has nothing to act on.
      const { h, organizationId } = await adminApp();
      try {
        mockAiState.mapping = { '2': 'ignore', '3': 'ignore' };

        await request(h.app.getHttpServer())
          .post(IMPORT_PATH)
          .send({
            csv: [
              'Service name,Price,Member price,Price ex VAT',
              'Signature Facial,€120,€90,€97.56',
            ].join('\n'),
          })
          .expect(CREATED);

        const row = await serviceNamed(organizationId, 'Signature Facial');
        expect(row?.priceCents).toBe(12000);
        expect(row?.description).toContain('Member price: €90');
        expect(row?.description).toContain('Price ex VAT: €97.56');
      } finally {
        await h.close();
      }
    });

    it('a model answer cannot re-point a column the synonym table resolved', async () => {
      // The model is told the heuristic result for every column. If it tries
      // to overrule one — here, calling the real price column a category —
      // the heuristic must win, or one bad completion silently reshapes a
      // whole catalogue.
      const { h, organizationId } = await adminApp();
      try {
        mockAiState.mapping = { '0': 'category', '1': 'category' };

        await request(h.app.getHttpServer())
          .post(IMPORT_PATH)
          .send({ csv: 'Service name,Price\nSignature Facial,€120' })
          .expect(CREATED);

        const row = await serviceNamed(organizationId, 'Signature Facial');
        expect(row?.name).toBe('Signature Facial');
        expect(row?.priceCents).toBe(12000);
        expect(await categoriesOf(organizationId)).toHaveLength(0);
      } finally {
        await h.close();
      }
    });

    it('uses the model to place a column the synonym table cannot, and still imports if it fails', async () => {
      const { h, organizationId } = await adminApp();
      const csv = 'Service,Tariff,Appt length\nIPL Photofacial,€145,75';
      try {
        // With the model available, the unknown headers land on real fields.
        mockAiState.mapping = { '1': 'price', '2': 'duration' };
        await request(h.app.getHttpServer())
          .post(IMPORT_PATH)
          .send({ csv })
          .expect(CREATED);

        const placed = await serviceNamed(organizationId, 'IPL Photofacial');
        expect(placed?.priceCents).toBe(14500);
        expect(placed?.appointmentDuration).toBe(75);
      } finally {
        await h.close();
      }

      // …and with the model failing, the SAME file still imports — the values
      // land in the description rather than being lost.
      const fallback = await adminApp();
      try {
        mockAiState.mapping = null; // chatCompletion throws
        await request(fallback.h.app.getHttpServer())
          .post(IMPORT_PATH)
          .send({ csv })
          .expect(CREATED);

        const row = await serviceNamed(
          fallback.organizationId,
          'IPL Photofacial'
        );
        expect(row).toBeDefined();
        expect(row?.description).toContain('Tariff: €145');
        expect(row?.description).toContain('Appt length: 75');
      } finally {
        await fallback.h.close();
      }
    });

    it('leaves a real Notes column unlabelled — only salvaged columns get a prefix', async () => {
      // The prefix exists to tell a clinic which column something fell out of.
      // An actual notes column has not fallen out of anywhere, so prefixing it
      // would just be noise in the copy customers read.
      const { h, organizationId } = await adminApp();
      try {
        await request(h.app.getHttpServer())
          .post(IMPORT_PATH)
          .send({
            csv: [
              'Service name,Description,Notes',
              'Glow Facial,Deep cleanse and mask.,Patch test needed',
            ].join('\n'),
          })
          .expect(CREATED);

        const row = await serviceNamed(organizationId, 'Glow Facial');
        expect(row?.description).toBe(
          'Deep cleanse and mask.\nPatch test needed'
        );
      } finally {
        await h.close();
      }
    });

    it('drops only the rows with no name, counts them, and still imports the rest', async () => {
      const { h, organizationId } = await adminApp();
      try {
        const res = await request(h.app.getHttpServer())
          .post(IMPORT_PATH)
          .send({
            csv: [
              'Service name,Price',
              'Real Service,€50',
              ',€45',
              'Another Real Service,€60',
            ].join('\n'),
          })
          .expect(CREATED);

        expect(res.body).toMatchObject({ imported: 2, skippedRows: 1 });
        expect(
          (await servicesOf(organizationId)).map((r) => r.name).sort()
        ).toEqual(['Another Real Service', 'Real Service']);
      } finally {
        await h.close();
      }
    });
  });

  describe('duplicates meet the unique constraint, they do not race it', () => {
    it('skips an existing name by default and leaves the stored row untouched', async () => {
      const { h, organizationId } = await adminApp();
      try {
        await seedService({ organizationId, name: 'Signature Facial' });

        const res = await request(h.app.getHttpServer())
          .post(IMPORT_PATH)
          .send({ csv: 'Service name,Price\nSignature Facial,€999' })
          .expect(CREATED);

        expect(res.body).toMatchObject({ imported: 0, skipped: 1, updated: 0 });

        const rows = (await servicesOf(organizationId)).filter(
          (r) => r.name === 'Signature Facial'
        );
        expect(rows).toHaveLength(1);
        // Untouched: the seeded row never had a price, and skip means skip.
        expect(rows[0]?.priceCents).toBeNull();
      } finally {
        await h.close();
      }
    });

    it('onDuplicate:update overwrites in place without creating a second row', async () => {
      const { h, organizationId } = await adminApp();
      try {
        const existingId = await seedService({
          organizationId,
          name: 'Signature Facial',
        });

        const res = await request(h.app.getHttpServer())
          .post(IMPORT_PATH)
          .send({
            csv: 'Service name,Price,Duration\nSignature Facial,€120,60',
            onDuplicate: 'update',
          })
          .expect(CREATED);

        expect(res.body).toMatchObject({ imported: 0, updated: 1 });

        const rows = (await servicesOf(organizationId)).filter(
          (r) => r.name === 'Signature Facial'
        );
        expect(rows).toHaveLength(1);
        expect(rows[0]?.id).toBe(existingId); // same row, not a replacement
        expect(rows[0]?.priceCents).toBe(12000);
        expect(rows[0]?.appointmentDuration).toBe(60);
      } finally {
        await h.close();
      }
    });

    it('handles the same service appearing twice inside ONE file', async () => {
      // `createService` does a read-then-insert on (organizationId, name), so
      // this is the case that would race the unique constraint if the rows were
      // ever written concurrently.
      const { h, organizationId } = await adminApp();
      try {
        const res = await request(h.app.getHttpServer())
          .post(IMPORT_PATH)
          .send({
            csv: [
              'Service name,Price',
              'Signature Facial,€85',
              'Signature Facial,€90',
            ].join('\n'),
          })
          .expect(CREATED);

        expect(res.body).toMatchObject({ imported: 1, skipped: 1 });

        const rows = (await servicesOf(organizationId)).filter(
          (r) => r.name === 'Signature Facial'
        );
        expect(rows).toHaveLength(1);
        expect(rows[0]?.priceCents).toBe(8500); // the FIRST row won
      } finally {
        await h.close();
      }
    });
  });

  describe('categories', () => {
    it('matches an existing category case-insensitively and creates only what is missing', async () => {
      const { h, organizationId } = await adminApp();
      try {
        await db.insert(organizationServiceCategory).values({
          id: `cat_${Date.now()}`,
          organizationId,
          name: 'Facials',
        });

        const res = await request(h.app.getHttpServer())
          .post(IMPORT_PATH)
          .send({
            csv: [
              'Service name,Category',
              'Glow Facial,facials',
              'Lip Filler,Injectables',
            ].join('\n'),
          })
          .expect(CREATED);

        expect(res.body).toMatchObject({ categoriesCreated: 1 });

        const categories = await categoriesOf(organizationId);
        expect(categories.map((c) => c.name).sort()).toEqual([
          'Facials',
          'Injectables',
        ]);

        // "facials" resolved to the EXISTING row rather than making a second.
        const byName = new Map(categories.map((c) => [c.name, c.id]));
        const glow = await serviceNamed(organizationId, 'Glow Facial');
        expect(glow?.categoryId).toBe(byName.get('Facials'));
      } finally {
        await h.close();
      }
    });

    it('createMissingCategories:false creates nothing and leaves the row uncategorised', async () => {
      const { h, organizationId } = await adminApp();
      try {
        await request(h.app.getHttpServer())
          .post(IMPORT_PATH)
          .send({
            csv: 'Service name,Category\nGlow Facial,Facials',
            createMissingCategories: false,
          })
          .expect(CREATED);

        expect(await categoriesOf(organizationId)).toHaveLength(0);
        const row = await serviceNamed(organizationId, 'Glow Facial');
        expect(row).toBeDefined();
        expect(row?.categoryId).toBeNull();
      } finally {
        await h.close();
      }
    });
  });

  describe('flags and boundaries', () => {
    it('importAsInactive writes every row switched off', async () => {
      const { h, organizationId } = await adminApp();
      try {
        await request(h.app.getHttpServer())
          .post(IMPORT_PATH)
          .send({
            csv: 'Service name,Price\nGlow Facial,€85\nLip Filler,€250',
            importAsInactive: true,
          })
          .expect(CREATED);

        const rows = await servicesOf(organizationId);
        expect(rows).toHaveLength(2);
        expect(rows.every((r) => r.isActive === false)).toBe(true);
      } finally {
        await h.close();
      }
    });

    it('a non-admin member is refused by @RequireRole and writes nothing', async () => {
      // The rest of this controller has no @RequireRole; this route does,
      // because one call can rewrite the whole catalogue. Worth pinning: the
      // guard is the only thing standing between a junior member and a bulk
      // overwrite.
      const member = await seedOrgWithMember('member');
      const h = await buildControllerApp(OrganizationServicesController, {
        userId: member.userId,
        organizationId: member.organizationId,
      });
      try {
        await request(h.app.getHttpServer())
          .post(IMPORT_PATH)
          .send({ csv: 'Service name,Price\nSmuggled Service,€1' })
          .expect(FORBIDDEN);

        expect(await servicesOf(member.organizationId)).toHaveLength(0);
      } finally {
        await h.close();
      }
    });

    it('imports into the ACTIVE org only, never a same-named service elsewhere', async () => {
      const { h, organizationId } = await adminApp();
      const other = await seedOrgWithMember('admin');
      try {
        const otherId = await seedService({
          organizationId: other.organizationId,
          name: 'Signature Facial',
        });

        await request(h.app.getHttpServer())
          .post(IMPORT_PATH)
          .send({
            csv: 'Service name,Price\nSignature Facial,€120',
            onDuplicate: 'update',
          })
          .expect(CREATED);

        // A NEW row in the acting org…
        const mine = await serviceNamed(organizationId, 'Signature Facial');
        expect(mine?.priceCents).toBe(12000);
        // …and the other org's identically-named row is untouched.
        const theirs = await db.query.organizationService.findFirst({
          where: eq(organizationService.id, otherId),
        });
        expect(theirs?.priceCents).toBeNull();
        expect(theirs?.organizationId).toBe(other.organizationId);
      } finally {
        await h.close();
      }
    });
  });

  describe('rejections write nothing', () => {
    it('rejects a file with no recognisable service columns', async () => {
      const { h, organizationId } = await adminApp();
      try {
        const res = await request(h.app.getHttpServer())
          .post(IMPORT_PATH)
          .send({
            csv: 'Invoice reference,Ledger code\nINV-001,4820\nINV-002,4821',
            fileName: 'ledger.csv',
          });

        expect(res.status).toBe(BAD_REQUEST);
        expect(res.body.message).toMatch(/could not recognise/i);
        expect(await servicesOf(organizationId)).toHaveLength(0);
      } finally {
        await h.close();
      }
    });

    it('rejects a file past the row cap rather than importing a prefix of it', async () => {
      // A partial import is the worst outcome: the clinic cannot tell which
      // half landed.
      const { h, organizationId } = await adminApp();
      try {
        const rows = ['Service name,Price'];
        for (let i = 0; i < 1_001; i++) rows.push(`Service ${i},€10`);

        const res = await request(h.app.getHttpServer())
          .post(IMPORT_PATH)
          .send({ csv: rows.join('\n') });

        expect(res.status).toBe(BAD_REQUEST);
        expect(res.body.message).toMatch(/too many rows/i);
        expect(await servicesOf(organizationId)).toHaveLength(0);
      } finally {
        await h.close();
      }
    });

    it('rejects a body with neither csv nor fileBase64', async () => {
      const { h, organizationId } = await adminApp();
      try {
        await request(h.app.getHttpServer())
          .post(IMPORT_PATH)
          .send({ onDuplicate: 'skip' })
          .expect(BAD_REQUEST);

        expect(await servicesOf(organizationId)).toHaveLength(0);
      } finally {
        await h.close();
      }
    });

    it('rejects a legacy .xls with an instruction rather than a parse error', async () => {
      const { h } = await adminApp();
      try {
        // OLE compound-file magic — what a real .xls starts with.
        const ole = Buffer.from([
          0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 0x00, 0x00,
        ]);

        const res = await request(h.app.getHttpServer())
          .post(IMPORT_PATH)
          .send({ fileBase64: ole.toString('base64'), fileName: 'old.xls' });

        expect(res.status).toBe(BAD_REQUEST);
        expect(res.body.message).toMatch(/\.xlsx or \.csv/i);
      } finally {
        await h.close();
      }
    });
  });
});
