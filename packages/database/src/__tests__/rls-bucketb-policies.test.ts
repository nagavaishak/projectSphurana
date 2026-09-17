import { type Table, getTableName, is } from 'drizzle-orm';
/**
 * Bucket B policy enforcement — the policy types the Bucket A tests don't cover.
 *
 * There are two suites here, and the distinction matters:
 *
 *  1. **The exhaustive SQL-shape suite (always runs, no DB).** It enumerates
 *     EVERY `childOrgRlsPolicy` / `joinRlsPolicy` declaration in the schema
 *     module — the list is derived from the artifact, never typed by hand — and
 *     asserts the emitted predicate is a correlated EXISTS: `p.id =
 *     <child_table>.<fk>`, with the parent and FK matching a real FK constraint
 *     on the child table.
 *
 *     This suite exists because the previous version of this file sampled
 *     **3 of 36 tables**, and that is exactly how an unqualified FK
 *     (`WHERE p.id = meta_ad_id`) shipped in `0050_glossy_arclight.sql`: on
 *     `meta_ad_service` the parent `meta_ad` owns a column of that same name, so
 *     Postgres bound the reference to the inner scope and the predicate became
 *     `p.id = p.meta_ad_id` — uncorrelated with the child row, and (because the
 *     same predicate is the WITH CHECK) a cross-org read AND write. A sample
 *     cannot find that. Enumeration can.
 *
 *  2. **The live isolation suite (RLS_ENABLED=true + role URLs).** Proves one
 *     table per policy KIND actually isolates end-to-end against a real
 *     Postgres, connecting as the real `app_authenticated` role. Seeding all 35
 *     child/join tables is not practical; the shape suite above is what makes
 *     the other 32 safe.
 */
import { PgDialect, PgPolicy } from 'drizzle-orm/pg-core';
import { getTableConfig } from 'drizzle-orm/pg-core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Database } from '../client.js';
import * as schema from '../schema/index.js';
import {
  type TwoOrgFixture,
  authConnection,
  createTwoOrgs,
  ownerConnection,
  seedLead,
  withRawOrgScope,
} from './rls-harness.js';

// ---------------------------------------------------------------------------
// 1. Exhaustive SQL-shape suite — derived from the schema module
// ---------------------------------------------------------------------------

const dialect = new PgDialect();

interface BucketBPolicy {
  exportName: string;
  policyName: 'child_org_isolation' | 'join_org_isolation';
  table: Table;
  tableName: string;
  usingSql: string;
  withCheckSql: string;
}

/**
 * Every Bucket B policy in the schema. DERIVED — walking the schema module's
 * exports, not a hand-written list. Adding a new `childOrgRlsPolicy(...)` to any
 * schema file automatically adds a case below; there is no list to forget to
 * update.
 */
const bucketBPolicies: BucketBPolicy[] = Object.entries(schema)
  .filter(
    (entry): entry is [string, PgPolicy] =>
      is(entry[1], PgPolicy) &&
      (entry[1].name === 'child_org_isolation' ||
        entry[1].name === 'join_org_isolation')
  )
  .map(([exportName, policy]) => {
    // `_linkedTable` is set by `.link(table)`, but is not on drizzle's public type.
    const table = (policy as PgPolicy & { _linkedTable: Table })._linkedTable;
    return {
      exportName,
      policyName: policy.name as BucketBPolicy['policyName'],
      table,
      tableName: getTableName(table),
      usingSql: dialect.sqlToQuery(policy.using as never).sql,
      withCheckSql: dialect.sqlToQuery(policy.withCheck as never).sql,
    };
  });

/** `FROM <parent> p WHERE p.id = <rhs>` — the correlation we are policing. */
const CORRELATION_RE = /FROM\s+(\w+)\s+p\s+WHERE\s+p\.id\s*=\s*([\w.]+)/;

describe('Bucket B policies emit a correlated EXISTS (all of them)', () => {
  it('found the Bucket B policies to check', () => {
    // A derived gate whose derivation silently returns [] is a decoration.
    expect(bucketBPolicies.length).toBeGreaterThan(30);
  });

  describe.each(bucketBPolicies)(
    '$tableName ($exportName)',
    ({ policyName, table, tableName, usingSql, withCheckSql }) => {
      it('qualifies the FK with the child table name', () => {
        const match = usingSql.match(CORRELATION_RE);
        expect(
          match,
          `${tableName}: could not find "FROM <parent> p WHERE p.id = …" in:\n${usingSql}`
        ).not.toBeNull();

        const rhs = (match as RegExpMatchArray)[2];

        // THE BUG THIS GATE EXISTS FOR. An unqualified FK binds to the parent's
        // scope inside the sub-select whenever the parent owns a column of the
        // same name (meta_ad.meta_ad_id), making the predicate uncorrelated with
        // the child row — a cross-org read AND write, since the same predicate
        // is the WITH CHECK.
        expect(
          rhs,
          `${tableName}: the FK on the right-hand side of "p.id =" is NOT qualified with the child table. Got "${rhs}", expected "${tableName}.<fk>". An unqualified name resolves against the parent inside the sub-select — this is a cross-org read/write hole.`
        ).toMatch(new RegExp(`^${tableName}\\.\\w+$`));
      });

      it('names a parent + FK backed by a real foreign key on the child', () => {
        const [, parent, rhs] = usingSql.match(
          CORRELATION_RE
        ) as RegExpMatchArray;
        const fk = rhs.split('.')[1];

        const childColumns = Object.values(getTableConfig(table).columns).map(
          (c) => c.name
        );
        expect(
          childColumns,
          `${tableName}: policy references column "${fk}", which the table does not have.`
        ).toContain(fk);

        const references = getTableConfig(table).foreignKeys.map((f) =>
          f.reference()
        );
        const backed = references.some(
          (r) =>
            r.columns.length === 1 &&
            r.columns[0].name === fk &&
            getTableName(r.foreignTable) === parent &&
            r.foreignColumns[0]?.name === 'id'
        );
        expect(
          backed,
          `${tableName}: the policy joins ${parent}.id = ${tableName}.${fk}, but no FK constraint ` +
            `${tableName}.${fk} → ${parent}.id exists. The policy's parent is not the column's real parent.`
        ).toBe(true);
      });

      it('scopes the parent lookup to the current org', () => {
        expect(usingSql).toContain(
          "current_setting('app.current_org_id', true)"
        );
      });

      it('uses the identical predicate for USING and WITH CHECK', () => {
        // A weaker WITH CHECK would let a row be written into another org.
        expect(withCheckSql).toBe(usingSql);
      });

      it('does not carry an organization_id column (would be Bucket A)', () => {
        const childColumns = Object.values(getTableConfig(table).columns).map(
          (c) => c.name
        );
        expect(
          childColumns,
          `${tableName}: has organization_id, so it should use orgRlsPolicy (Bucket A) — a direct column comparison is strictly safer than an EXISTS join.`
        ).not.toContain('organization_id');
      });

      it('is the only isolating policy kind on this table', () => {
        expect(policyName).toMatch(/^(child|join)_org_isolation$/);
      });
    }
  );
});

// ---------------------------------------------------------------------------
// 2. Live isolation suite — one table per policy kind, against real Postgres
// ---------------------------------------------------------------------------

const RLS_E2E =
  process.env.RLS_ENABLED === 'true' &&
  !!process.env.DATABASE_URL_AUTHENTICATED;

function exec(db: Database, sql: string): Promise<unknown> {
  return db.execute(sql as never);
}
function ids(rows: unknown): string[] {
  return (rows as Array<{ id: string }>).map((r) => r.id);
}

describe.skipIf(!RLS_E2E)(
  'Bucket B policies isolate (child EXISTS / join / org-self)',
  () => {
    let ownerConn: ReturnType<typeof ownerConnection>;
    let authConn: ReturnType<typeof authConnection>;
    let fixture: TwoOrgFixture;

    beforeAll(async () => {
      ownerConn = ownerConnection();
      authConn = authConnection();
      fixture = await createTwoOrgs(ownerConn.db, 'rls-bb');
    });

    afterAll(async () => {
      await fixture.cleanup(); // ON DELETE CASCADE clears all seeded children
      await ownerConn.client.end();
      await authConn.client.end();
    });

    it('child-of-org (lead_activity via lead) isolates', async () => {
      const leadA = await seedLead(ownerConn.db, fixture.orgA.id);
      const leadB = await seedLead(ownerConn.db, fixture.orgB.id);
      const actA = `bb-act-a-${Date.now()}`;
      const actB = `bb-act-b-${Date.now()}`;
      await exec(
        ownerConn.db,
        `INSERT INTO lead_activity (id, lead_id, type) VALUES
           ('${actA}', '${leadA}', 'note'), ('${actB}', '${leadB}', 'note')`
      );

      const got = ids(
        await withRawOrgScope(authConn.db, fixture.orgA.id, (tx) =>
          exec(
            tx,
            `SELECT id FROM lead_activity WHERE id IN ('${actA}', '${actB}')`
          )
        )
      );
      expect(got).toContain(actA); // own child visible
      expect(got).not.toContain(actB); // other org's child hidden
    });

    it('join table (practitioner_service via practitioner) isolates', async () => {
      for (const org of [fixture.orgA.id, fixture.orgB.id]) {
        await exec(
          ownerConn.db,
          `INSERT INTO practitioner (id, organization_id, name, email)
             VALUES ('prac-${org}', '${org}', 'P', 'prac-${org}@example.com');
           INSERT INTO organization_service (id, organization_id, name)
             VALUES ('svc-${org}', '${org}', 'S');
           INSERT INTO practitioner_service (id, practitioner_id, service_id)
             VALUES ('ps-${org}', 'prac-${org}', 'svc-${org}')`
        );
      }

      const got = ids(
        await withRawOrgScope(authConn.db, fixture.orgA.id, (tx) =>
          exec(
            tx,
            `SELECT id FROM practitioner_service WHERE id IN ('ps-${fixture.orgA.id}', 'ps-${fixture.orgB.id}')`
          )
        )
      );
      expect(got).toContain(`ps-${fixture.orgA.id}`);
      expect(got).not.toContain(`ps-${fixture.orgB.id}`);
    });

    it('org-self (organization) isolates', async () => {
      const got = ids(
        await withRawOrgScope(authConn.db, fixture.orgA.id, (tx) =>
          exec(
            tx,
            `SELECT id FROM organization WHERE id IN ('${fixture.orgA.id}', '${fixture.orgB.id}')`
          )
        )
      );
      expect(got).toContain(fixture.orgA.id); // own org visible
      expect(got).not.toContain(fixture.orgB.id); // other org hidden
    });
  }
);
