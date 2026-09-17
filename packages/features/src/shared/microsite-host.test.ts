import type { MicrositeDomainStatus } from '@borradh-workspace/database';
import { describe, expect, it, vi } from '@borradh-workspace/testing';
import type { SQL } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';
import {
  pathTierLinkTarget,
  resolveMicrositeLinkTarget,
  resolveMicrositeLinkTargets,
  resolvePrimaryMicrositeDomain,
} from './microsite-host.js';

interface DomainRow {
  organizationId: string;
  domain: string;
  isPrimary: boolean;
  status: MicrositeDomainStatus;
}

const dialect = new PgDialect();

const COLUMN_TO_FIELD: Record<string, keyof DomainRow> = {
  organization_id: 'organizationId',
  is_primary: 'isPrimary',
  status: 'status',
};

/**
 * Evaluate the service's REAL where-clause against in-memory rows.
 *
 * The point is that the status/isPrimary rule is asserted against the SQL the
 * service actually builds, not against a mock that was hand-told which rows to
 * return. A mock that just resolves a row would pass even if the service
 * dropped `status = 'active'` from the query — which is precisely the bug that
 * would send a tenant's customers to a hostname with no DNS record.
 */
const matches = (where: SQL | undefined, row: DomainRow): boolean => {
  if (!where) return true;
  const { sql, params } = dialect.sqlToQuery(where);
  const param = (placeholder: string) =>
    params[Number(placeholder.slice(1)) - 1];

  const equalities = [...sql.matchAll(/"(\w+)"\s*=\s*(\$\d+)/g)];
  const inClauses = [...sql.matchAll(/"(\w+)" in \(([^)]*)\)/g)];
  // Every predicate in the clause must be recognised, or the test is silently
  // ignoring part of the rule it exists to pin.
  expect(equalities.length + inClauses.length).toBeGreaterThan(0);

  for (const [, column, placeholder] of equalities) {
    const field = COLUMN_TO_FIELD[column];
    expect(field).toBeDefined();
    if (row[field] !== param(placeholder)) return false;
  }
  for (const [, column, list] of inClauses) {
    const field = COLUMN_TO_FIELD[column];
    expect(field).toBeDefined();
    const values = list.split(',').map((p) => param(p.trim()));
    if (!values.includes(row[field])) return false;
  }
  return true;
};

const makeDb = (rows: DomainRow[]) => ({
  query: {
    micrositeDomain: {
      findFirst: vi.fn(async ({ where }: { where?: SQL }) =>
        rows.find((row) => matches(where, row))
      ),
      findMany: vi.fn(async ({ where }: { where?: SQL }) =>
        rows.filter((row) => matches(where, row))
      ),
    },
  },
});

const row = (over: Partial<DomainRow> = {}): DomainRow => ({
  organizationId: 'org-1',
  domain: 'glowaesthetics.ie',
  isPrimary: true,
  status: 'active',
  ...over,
});

describe('resolvePrimaryMicrositeDomain', () => {
  it('returns the live primary domain', async () => {
    const db = makeDb([row()]);
    await expect(
      resolvePrimaryMicrositeDomain(db as never, 'org-1')
    ).resolves.toBe('glowaesthetics.ie');
  });

  it('returns null when the org has no domain rows at all', async () => {
    const db = makeDb([]);
    await expect(
      resolvePrimaryMicrositeDomain(db as never, 'org-1')
    ).resolves.toBeNull();
  });

  it('never returns another org’s domain', async () => {
    const db = makeDb([row({ organizationId: 'org-2' })]);
    await expect(
      resolvePrimaryMicrositeDomain(db as never, 'org-1')
    ).resolves.toBeNull();
  });

  // The fallback must be TOTAL: any status but `active` may have no DNS record
  // pointing at us, so a link built on it is dead — strictly worse than our own
  // host, which at least serves the page.
  const unusable: MicrositeDomainStatus[] = [
    'pending_dns',
    'verifying',
    'error',
    'removed',
  ];
  for (const status of unusable) {
    it(`ignores a primary domain in status '${status}'`, async () => {
      const db = makeDb([row({ status })]);
      await expect(
        resolvePrimaryMicrositeDomain(db as never, 'org-1')
      ).resolves.toBeNull();
    });
  }

  it('ignores an active domain that is not primary', async () => {
    const db = makeDb([row({ isPrimary: false })]);
    await expect(
      resolvePrimaryMicrositeDomain(db as never, 'org-1')
    ).resolves.toBeNull();
  });

  it('picks the active primary out of a mixed set', async () => {
    const db = makeDb([
      row({ domain: 'old.example', isPrimary: false, status: 'removed' }),
      row({ domain: 'www.glowaesthetics.ie', isPrimary: false }),
      row({ domain: 'pending.example', status: 'pending_dns' }),
      row({ domain: 'glowaesthetics.ie' }),
    ]);
    await expect(
      resolvePrimaryMicrositeDomain(db as never, 'org-1')
    ).resolves.toBe('glowaesthetics.ie');
  });
});

describe('resolveMicrositeLinkTarget', () => {
  it('carries the slug alongside the live domain', async () => {
    const db = makeDb([row()]);
    await expect(
      resolveMicrositeLinkTarget(db as never, { id: 'org-1', slug: 'glow' })
    ).resolves.toEqual({
      organizationSlug: 'glow',
      primaryDomain: 'glowaesthetics.ie',
    });
  });

  it('falls back to the path-tier target', async () => {
    const db = makeDb([row({ status: 'verifying' })]);
    await expect(
      resolveMicrositeLinkTarget(db as never, { id: 'org-1', slug: 'glow' })
    ).resolves.toEqual(pathTierLinkTarget('glow'));
  });
});

describe('resolveMicrositeLinkTargets (batch)', () => {
  it('resolves many orgs in ONE query', async () => {
    const db = makeDb([
      row({ organizationId: 'org-1' }),
      row({ organizationId: 'org-2', domain: 'bayside.co.uk' }),
      row({ organizationId: 'org-3', status: 'pending_dns' }),
    ]);

    const targets = await resolveMicrositeLinkTargets(db as never, [
      { id: 'org-1', slug: 'glow' },
      { id: 'org-2', slug: 'bayside' },
      { id: 'org-3', slug: 'pending' },
      { id: 'org-4', slug: 'nodomain' },
    ]);

    // The whole reason this exists: an email loop must not be one query per
    // recipient.
    expect(db.query.micrositeDomain.findMany).toHaveBeenCalledTimes(1);
    expect(db.query.micrositeDomain.findFirst).not.toHaveBeenCalled();

    expect(targets.get('org-1')).toEqual({
      organizationSlug: 'glow',
      primaryDomain: 'glowaesthetics.ie',
    });
    expect(targets.get('org-2')).toEqual({
      organizationSlug: 'bayside',
      primaryDomain: 'bayside.co.uk',
    });
    // Present, not missing — callers never have to interpret an absent key.
    expect(targets.get('org-3')).toEqual(pathTierLinkTarget('pending'));
    expect(targets.get('org-4')).toEqual(pathTierLinkTarget('nodomain'));
  });

  it('queries nothing for an empty list', async () => {
    const db = makeDb([row()]);
    const targets = await resolveMicrositeLinkTargets(db as never, []);
    expect(targets.size).toBe(0);
    expect(db.query.micrositeDomain.findMany).not.toHaveBeenCalled();
  });
});
