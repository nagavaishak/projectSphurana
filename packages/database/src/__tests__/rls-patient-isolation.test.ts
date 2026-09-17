/**
 * Patient portal RLS — the per-ROW scope (ENG-647).
 *
 * `app_patient` is the only role in the system scoped per row rather than per
 * org: the `patient_self` policies key on `app.current_patient_lead_id`, so a
 * signed-in CUSTOMER can only ever see their own record. Until this file
 * existed, nothing exercised that role at all — the harness had connections
 * for `app_authenticated`, `app_public`, `app_system` and the owner, and none
 * for `app_patient`.
 *
 * Runs ONLY against a real RLS-enabled database:
 *   - RLS_ENABLED=true
 *   - DATABASE_URL_PATIENT (provisioned `app_patient` role)
 *   - DATABASE_URL (owner, for seeding/teardown)
 * Otherwise every block skips, so normal CI stays green.
 *
 * Local run (against the throwaway test DB):
 *   RLS_ENABLED=true \
 *   DATABASE_URL=postgres://postgres:postgres@localhost:5432/borradh_rls_test \
 *   DATABASE_URL_PATIENT=postgres://app_patient:<pw>@localhost:5432/borradh_rls_test \
 *   pnpm --filter @borradh-workspace/database exec vitest run src/__tests__/rls-patient-isolation.test.ts
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  type TwoOrgFixture,
  createTwoOrgs,
  ownerConnection,
  patientConnection,
  seedLead,
  withNoPatientScope,
  withRawPatientScope,
} from './rls-harness.js';

const RLS_E2E =
  process.env.RLS_ENABLED === 'true' && !!process.env.DATABASE_URL_PATIENT;

/**
 * Assert a query was refused by Postgres privileges.
 *
 * Drizzle wraps the driver error: `err.message` is only
 * "Failed query: SELECT ...", and the actual Postgres text ("permission denied
 * for column notes") lives on `err.cause`. Matching on `message` alone passes
 * for ANY query failure — a typo'd column, a missing table — so it would
 * report success while proving nothing. Walk the chain instead.
 */
async function expectPermissionDenied(run: () => Promise<unknown>) {
  let thrown: unknown;
  try {
    await run();
  } catch (error) {
    thrown = error;
  }

  expect(
    thrown,
    'expected the query to be refused, but it succeeded'
  ).toBeDefined();

  const chain: string[] = [];
  for (let e = thrown; e; e = (e as { cause?: unknown }).cause) {
    const message = (e as { message?: string }).message;
    if (message) chain.push(message);
    if (chain.length > 5) break;
  }

  expect(chain.join(' | ')).toMatch(/permission denied/i);
}

describe.skipIf(!RLS_E2E)('Patient portal RLS (app_patient)', () => {
  let ownerConn: ReturnType<typeof ownerConnection>;
  let patientConn: ReturnType<typeof patientConnection>;
  let fixture: TwoOrgFixture;

  /** The signed-in customer. */
  let selfLeadId: string;
  /** Another customer at the SAME clinic. */
  let siblingLeadId: string;
  /** A customer at a DIFFERENT clinic. */
  let foreignLeadId: string;

  beforeAll(async () => {
    ownerConn = ownerConnection();
    patientConn = patientConnection();
    fixture = await createTwoOrgs(ownerConn.db, 'rls-patient');

    selfLeadId = await seedLead(ownerConn.db, fixture.orgA.id, {
      firstName: 'Self',
    });
    siblingLeadId = await seedLead(ownerConn.db, fixture.orgA.id, {
      firstName: 'Sibling',
    });
    foreignLeadId = await seedLead(ownerConn.db, fixture.orgB.id, {
      firstName: 'Foreign',
    });

    // Staff-internal commentary on the customer's OWN row. If the column grant
    // is table-wide, this is exactly what leaks — to the person it describes.
    await ownerConn.db.execute(
      `UPDATE lead SET notes = 'INTERNAL: do not show the patient',
                       portal_note = 'A note from your clinic'
       WHERE id = '${selfLeadId}'` as never
    );
  });

  afterAll(async () => {
    await fixture?.cleanup();
    await ownerConn?.client.end();
    await patientConn?.client.end();
  });

  // -------------------------------------------------------------------------
  // Per-row isolation — the property the whole design rests on
  // -------------------------------------------------------------------------

  it('sees its own lead row', async () => {
    const rows = await withRawPatientScope(
      patientConn.db,
      selfLeadId,
      fixture.orgA.id,
      (tx) =>
        tx.execute(`SELECT id FROM lead WHERE id = '${selfLeadId}'` as never)
    );
    expect(Array.from(rows as Iterable<unknown>)).toHaveLength(1);
  });

  it('cannot see another customer at the SAME clinic', async () => {
    // Deliberately permissive WHERE: if the policy is the thing doing the
    // filtering, this still returns nothing. If the app's WHERE clause was
    // the only guard, this returns the sibling.
    const rows = await withRawPatientScope(
      patientConn.db,
      selfLeadId,
      fixture.orgA.id,
      (tx) => tx.execute('SELECT id FROM lead WHERE true' as never)
    );
    const ids = Array.from(rows as Iterable<{ id: string }>).map((r) => r.id);
    expect(ids).not.toContain(siblingLeadId);
    expect(ids).toEqual([selfLeadId]);
  });

  it('cannot see a customer at a DIFFERENT clinic', async () => {
    const rows = await withRawPatientScope(
      patientConn.db,
      selfLeadId,
      fixture.orgA.id,
      (tx) =>
        tx.execute(`SELECT id FROM lead WHERE id = '${foreignLeadId}'` as never)
    );
    expect(Array.from(rows as Iterable<unknown>)).toHaveLength(0);
  });

  it('fails CLOSED when no patient scope is set', async () => {
    // A forgotten withPatientScope must yield zero rows, never all rows.
    const rows = await withNoPatientScope(patientConn.db, (conn) =>
      conn.execute('SELECT id FROM lead' as never)
    );
    expect(Array.from(rows as Iterable<unknown>)).toHaveLength(0);
  });

  // -------------------------------------------------------------------------
  // Column grant (0135) — RLS filters ROWS; the GRANT decides COLUMNS
  // -------------------------------------------------------------------------

  describe('column grant on lead', () => {
    const withheld = [
      'notes',
      'metadata',
      'tags',
      'human_takeover_requested',
      'status',
    ];

    it.each(withheld)(
      'is denied lead.%s even on its own row',
      async (column) => {
        await expectPermissionDenied(() =>
          withRawPatientScope(
            patientConn.db,
            selfLeadId,
            fixture.orgA.id,
            (tx) =>
              tx.execute(
                `SELECT ${column} FROM lead WHERE id = '${selfLeadId}'` as never
              )
          )
        );
      }
    );

    it('rejects a star-select, which is what findFirst emits', async () => {
      await expectPermissionDenied(() =>
        withRawPatientScope(patientConn.db, selfLeadId, fixture.orgA.id, (tx) =>
          tx.execute(`SELECT * FROM lead WHERE id = '${selfLeadId}'` as never)
        )
      );
    });

    it('permits exactly the columns the portal reads', async () => {
      const rows = await withRawPatientScope(
        patientConn.db,
        selfLeadId,
        fixture.orgA.id,
        (tx) =>
          tx.execute(
            `SELECT id, organization_id, first_name, last_name, email, phone, portal_note
             FROM lead WHERE id = '${selfLeadId}'` as never
          )
      );
      const [row] = Array.from(
        rows as Iterable<{ portal_note: string | null }>
      );
      expect(row.portal_note).toBe('A note from your clinic');
    });
  });

  // -------------------------------------------------------------------------
  // SELECT-only — every customer-initiated write goes through a system-scoped
  // service that re-verifies ownership itself
  // -------------------------------------------------------------------------

  describe('write refusal', () => {
    const tables = [
      'lead',
      'appointment',
      'consent_form_submission',
      'patient_document',
      'patient_auth',
    ];

    it.each(tables)('cannot UPDATE %s', async (table) => {
      await expectPermissionDenied(() =>
        withRawPatientScope(patientConn.db, selfLeadId, fixture.orgA.id, (tx) =>
          tx.execute(`UPDATE ${table} SET id = id` as never)
        )
      );
    });

    it.each(tables)('cannot DELETE FROM %s', async (table) => {
      await expectPermissionDenied(() =>
        withRawPatientScope(patientConn.db, selfLeadId, fixture.orgA.id, (tx) =>
          tx.execute(`DELETE FROM ${table}` as never)
        )
      );
    });
  });

  // -------------------------------------------------------------------------
  // Org predicate (0138) — the DB checks the CLINIC too, not just the person
  // -------------------------------------------------------------------------

  /**
   * `withPatientScope` always set `app.current_org_id`, but until 0138 no
   * policy read it — so isolation reduced entirely to "the guard resolved the
   * right lead_id". A bug in the session → account → membership lookup that
   * returned the wrong membership would have produced a complete,
   * RLS-blessed read of another person's record, because the database was
   * never told which clinic the request was for.
   */
  describe('org predicate', () => {
    it('hides the row when the org GUC names a different clinic', async () => {
      const rows = await withRawPatientScope(
        patientConn.db,
        selfLeadId,
        fixture.orgB.id, // ← correct lead, WRONG clinic
        (tx) =>
          tx.execute(`SELECT id FROM lead WHERE id = '${selfLeadId}'` as never)
      );

      expect(Array.from(rows as Iterable<unknown>)).toHaveLength(0);
    });

    it('hides everything when the org GUC is absent', async () => {
      const rows = await patientConn.db.transaction(async (tx) => {
        await tx.execute(
          `SELECT set_config('app.current_patient_lead_id', '${selfLeadId}', true)` as never
        );
        // No app.current_org_id at all.
        return tx.execute('SELECT id FROM lead' as never);
      });

      expect(Array.from(rows as Iterable<unknown>)).toHaveLength(0);
    });

    it('still returns the row when BOTH the patient and the clinic match', async () => {
      const rows = await withRawPatientScope(
        patientConn.db,
        selfLeadId,
        fixture.orgA.id,
        (tx) =>
          tx.execute(`SELECT id FROM lead WHERE id = '${selfLeadId}'` as never)
      );

      expect(Array.from(rows as Iterable<unknown>)).toHaveLength(1);
    });
  });
});
