import { PgDialect } from 'drizzle-orm/pg-core';
import { describe, expect, it } from 'vitest';
import { sql } from '../sql-tag.js';

/**
 * Runtime coverage for the guarded `sql` tag (regression for ENG-479 /
 * Sentry API-BC / PR #637).
 *
 * The compile-time rejection of `Date` params is asserted in
 * `src/sql-tag.type-assertions.ts` (checked by `tsc`). Here we prove:
 *   1. the guarded tag is behaviourally identical to Drizzle's `sql` — no
 *      runtime divergence was introduced by the re-typing;
 *   2. the exact hazard the guard prevents is real: a raw `Date` becomes a
 *      `Date`-instance bound param (which makes postgres-js call
 *      `Buffer.byteLength(date)` and throw ERR_INVALID_ARG_TYPE), whereas the
 *      prescribed `.toISOString()` fix binds a plain string.
 */
describe('guarded sql tag', () => {
  const dialect = new PgDialect();

  it('preserves the Drizzle static methods', () => {
    expect(typeof sql.raw).toBe('function');
    expect(typeof sql.join).toBe('function');
    expect(typeof sql.identifier).toBe('function');
    expect(typeof sql.placeholder).toBe('function');
  });

  it('builds a normal parameterised query', () => {
    const { sql: text, params } = dialect.sqlToQuery(
      sql`SELECT * FROM x WHERE id = ${'abc'} AND n = ${3}`
    );
    expect(text).toContain('WHERE id = $1');
    expect(params).toEqual(['abc', 3]);
  });

  it('demonstrates the #637 hazard: a raw Date binds a Date-instance param', () => {
    // Cast to bypass the compile-time guard so we can exercise the runtime
    // path the guard exists to forbid.
    const badDate = new Date('2026-01-02T03:04:05.000Z');
    const { params } = dialect.sqlToQuery(
      sql`WHERE created_at >= ${badDate as unknown as string}`
    );
    // This is precisely what postgres-js chokes on.
    expect(params.some((p) => p instanceof Date)).toBe(true);
  });

  it('the prescribed .toISOString() fix binds a string, not a Date', () => {
    const now = new Date('2026-01-02T03:04:05.000Z');
    const { params } = dialect.sqlToQuery(
      sql`WHERE created_at >= ${now.toISOString()}`
    );
    expect(params.every((p) => !(p instanceof Date))).toBe(true);
    expect(params).toEqual(['2026-01-02T03:04:05.000Z']);
  });
});
