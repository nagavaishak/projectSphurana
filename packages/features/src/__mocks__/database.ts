/**
 * Mock database module for tests.
 *
 * It exists for exactly one reason: to stop the real database CLIENT from being
 * initialized (that needs DATABASE_URL). The `db` query builder below is the
 * mock. Everything else — the whole schema surface — is re-exported verbatim
 * from the real schema module, which is pure constants and opens no connection.
 */

import { vi } from 'vitest';

// Lightweight parity with the real implementation (packages/database/src/retry.ts)
// so services that branch on transient-vs-poison DB failures can be unit-tested.
const TRANSIENT_DB_CODES = new Set([
  'CONNECTION_CLOSED',
  'CONNECTION_ENDED',
  'CONNECTION_DESTROYED',
  'CONNECT_TIMEOUT',
  'ECONNRESET',
  'EPIPE',
  'ETIMEDOUT',
]);
const TRANSIENT_DB_MESSAGE =
  /CONNECTION_CLOSED|CONNECTION_ENDED|connection (?:closed|terminated|reset|failure)|terminating connection|server closed the connection/i;
export const isTransientDbError = (error: unknown): boolean => {
  if (!error || typeof error !== 'object') return false;
  const code = (error as { code?: unknown }).code;
  if (typeof code === 'string' && TRANSIENT_DB_CODES.has(code)) return true;
  const message = (error as { message?: unknown }).message;
  return typeof message === 'string' && TRANSIENT_DB_MESSAGE.test(message);
};

// Keep the real helper's retry semantics in feature tests, but retry immediately
// so unit coverage neither sleeps nor needs fake timers. This lets services
// verify that a transient pooled-connection failure is retried rather than
// silently turning into an INTERNAL_ERROR.
export const withDbRetry = async <T>(fn: () => Promise<T>): Promise<T> => {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await fn();
    } catch (error) {
      if (attempt >= 5 || !isTransientDbError(error)) throw error;
    }
  }
};

// Constraint-violation predicate — parity with packages/database/src/constraints.ts.
//
// Inlined rather than re-exported from the real module ON PURPOSE. This file is
// loaded by every test in the package under `isolate: false`; adding a new
// cross-package module edge here changes module init order and leaks into
// unrelated suites (an added `export … from '@borradh-workspace/database/constraints'`
// reproducibly broke conversations/send-message). Same reasoning as the retry
// helpers above. The real implementation is unit-tested in packages/database.
const UNIQUE_VIOLATION = '23505';
const EXCLUSION_VIOLATION = '23P01';
const DEADLOCK_DETECTED = '40P01';
const FOREIGN_KEY_VIOLATION = '23503';
export const isUniqueViolation = (
  error: unknown,
  constraintName?: string
): boolean => {
  let current: unknown = error;
  for (let depth = 0; current != null && depth < 10; depth += 1) {
    if ((current as { code?: unknown }).code === UNIQUE_VIOLATION) {
      if (!constraintName) return true;
      const link = current as {
        constraint_name?: unknown;
        constraint?: unknown;
        message?: unknown;
      };
      const named = link.constraint_name ?? link.constraint;
      if (typeof named === 'string') return named === constraintName;
      if (typeof link.message === 'string') {
        return link.message.includes(constraintName);
      }
    }
    current = (current as { cause?: unknown }).cause;
  }
  return false;
};

export const isForeignKeyViolation = (
  error: unknown,
  constraintName?: string
): boolean => {
  let current: unknown = error;
  for (let depth = 0; current != null && depth < 10; depth += 1) {
    if ((current as { code?: unknown }).code === FOREIGN_KEY_VIOLATION) {
      if (!constraintName) return true;
      const link = current as {
        constraint_name?: unknown;
        constraint?: unknown;
        message?: unknown;
      };
      const named = link.constraint_name ?? link.constraint;
      if (typeof named === 'string') return named === constraintName;
      if (typeof link.message === 'string') {
        return link.message.includes(constraintName);
      }
    }
    current = (current as { cause?: unknown }).cause;
  }
  return false;
};

/**
 * Exclusion-constraint parity helper (`appointment_no_overlap`,
 * `resource_no_overlap`). Inlined for the same reason as `isUniqueViolation`
 * above.
 *
 * Walks the `.cause` chain because drizzle 0.45.2 re-throws every failed query
 * as a `DrizzleQueryError` whose message is the SQL text — the driver error
 * carrying SQLSTATE 23P01 and `constraint_name` sits underneath it. Tests that
 * exercise this must throw that same nested shape, or they pass while
 * production returns a 500.
 */
export const isExclusionViolation = (
  error: unknown,
  constraintName?: string
): boolean => {
  let current: unknown = error;
  for (let depth = 0; current != null && depth < 10; depth += 1) {
    if ((current as { code?: unknown }).code === EXCLUSION_VIOLATION) {
      if (!constraintName) return true;
      const link = current as {
        constraint_name?: unknown;
        constraint?: unknown;
        message?: unknown;
      };
      const named = link.constraint_name ?? link.constraint;
      if (typeof named === 'string') return named === constraintName;
      if (typeof link.message === 'string') {
        return link.message.includes(constraintName);
      }
    }
    current = (current as { cause?: unknown }).cause;
  }
  return false;
};

/**
 * Deadlock parity helper (SQLSTATE 40P01). Inlined for the same reason as the
 * two above — this file replaces the whole `@borradh-workspace/database` barrel
 * under the unit-test alias, so a helper missing here is `undefined` at the
 * call site, and the service under test dies on "is not a function" rather than
 * on the behaviour being asserted.
 */
export const isDeadlock = (error: unknown): boolean => {
  let current: unknown = error;
  for (let depth = 0; current != null && depth < 10; depth += 1) {
    if ((current as { code?: unknown }).code === DEADLOCK_DETECTED) return true;
    current = (current as { cause?: unknown }).cause;
  }
  return false;
};

/**
 * `pgViolation` / `mapDbError` parity — see packages/database/src/constraints.ts.
 * Inlined for the same reason as the booleans above.
 */
interface PgViolationInfo {
  code: string;
  constraint?: string;
  detail?: string;
  table?: string;
}
const KNOWN_VIOLATION_CODES = new Set([
  UNIQUE_VIOLATION,
  EXCLUSION_VIOLATION,
  FOREIGN_KEY_VIOLATION,
  DEADLOCK_DETECTED,
]);
export const pgViolation = (error: unknown): PgViolationInfo | null => {
  let current: unknown = error;
  for (let depth = 0; current != null && depth < 10; depth += 1) {
    const code = (current as { code?: unknown }).code;
    if (typeof code === 'string' && KNOWN_VIOLATION_CODES.has(code)) {
      const link = current as {
        constraint_name?: unknown;
        constraint?: unknown;
        detail?: unknown;
        table_name?: unknown;
      };
      const constraint = link.constraint_name ?? link.constraint;
      return {
        code,
        ...(typeof constraint === 'string' && { constraint }),
        ...(typeof link.detail === 'string' && { detail: link.detail }),
        ...(typeof link.table_name === 'string' && {
          table: link.table_name,
        }),
      };
    }
    current = (current as { cause?: unknown }).cause;
  }
  return null;
};
export const mapDbError = <T>(
  error: unknown,
  map: Record<string, () => T>
): T | null => {
  const violation = pgViolation(error);
  if (!violation?.constraint) return null;
  const build = map[violation.constraint];
  return build ? build() : null;
};

/**
 * Test fixtures reproducing drizzle's wrapped Postgres-error shape — parity
 * with packages/database/src/testing/pg-error.ts. Every test that exercises a
 * constraint-violation branch must build its thrown error with these, not a
 * flat `new Error(...)`, or it can pass against a service that only matches
 * `error.message` (the exact bug ENG-844 fixes) while production still 500s.
 */
export const drizzleUniqueViolation = (
  constraintName: string,
  options: { detail?: string; table?: string } = {}
): Error => {
  const { detail, table } = options;
  const cause = Object.assign(
    new Error(
      `duplicate key value violates unique constraint "${constraintName}"`
    ),
    {
      code: '23505',
      constraint_name: constraintName,
      ...(detail !== undefined && { detail }),
      ...(table !== undefined && { table_name: table }),
    }
  );
  return Object.assign(
    new Error(`Failed query: insert into "${table ?? 'unknown'}" …`),
    { cause }
  );
};
export const drizzleFkViolation = (
  constraintName: string,
  options: { detail?: string; table?: string } = {}
): Error => {
  const { detail, table } = options;
  const cause = Object.assign(
    new Error(
      `insert or update on table "${table ?? 'unknown'}" violates foreign key constraint "${constraintName}"`
    ),
    {
      code: '23503',
      constraint_name: constraintName,
      ...(detail !== undefined && { detail }),
      ...(table !== undefined && { table_name: table }),
    }
  );
  return Object.assign(
    new Error(`Failed query: insert into "${table ?? 'unknown'}" …`),
    { cause }
  );
};

// =============================================================================
// Re-export the ENTIRE database schema module.
//
// This single star is the whole schema surface: every label record, value array,
// pgEnum, TABLE object and type. It is DERIVED — there is no hand-written list to
// drift from the schema, in either direction. A table added to the schema appears
// here for free; a table deleted from the schema disappears here for free.
//
// (This file used to shadow the star with 124 hand-listed `createMockTable(...)`
// Proxy stand-ins. That list had drifted BOTH ways — 20 real tables missing from
// it, 15 stale tables in it that no longer exist — and the failure was silent: a
// table missing from the list simply fell through to the star and got the real
// pgTable, so it behaved differently from the other 124 with nothing to say so.
// The Proxies bought nothing: the schema module is pure constants and needs no DB
// connection, and the query builder is mocked below via `db`. Deleting them makes
// both drift directions unspellable. Column names are now real, so a service
// referencing a column that does not exist can no longer be papered over.)
// =============================================================================
export * from '@borradh-workspace/database/schema';

// The real `@borradh-workspace/database` barrel re-exports these drizzle-orm
// query operators, and some (older) services import them FROM the barrel rather
// than from `drizzle-orm` directly. Mirror that here so those imports resolve —
// the operators build SQL expression objects which the mock query-builder chain
// (`where()` etc.) simply ignores. Without this, a stripped file-local mock that
// used to supply identity-ish `eq`/`and` leaves them `undefined` and the
// service's WHERE clause explodes under `isolate: false`.
export {
  eq,
  and,
  or,
  gt,
  gte,
  lt,
  lte,
  ne,
  isNull,
  isNotNull,
  inArray,
  notInArray,
  like,
  ilike,
  notLike,
  asc,
  desc,
  sql,
} from 'drizzle-orm';

// Mock db instance - this will be replaced with createMockDatabase() in tests
export const db = {
  insert: vi.fn().mockReturnThis(),
  values: vi.fn().mockReturnThis(),
  returning: vi.fn().mockResolvedValue([]),
  select: vi.fn().mockReturnThis(),
  selectDistinct: vi.fn().mockReturnThis(),
  from: vi.fn().mockReturnThis(),
  where: vi.fn().mockReturnThis(),
  orderBy: vi.fn().mockReturnThis(),
  limit: vi.fn().mockReturnThis(),
  offset: vi.fn().mockReturnThis(),
  // Row-locking clause for SELECT … FOR UPDATE (e.g. deposit-webhook /
  // deposit-expiry idempotency). Chainable like the other builder methods.
  for: vi.fn().mockReturnThis(),
  leftJoin: vi.fn().mockReturnThis(),
  innerJoin: vi.fn().mockReturnThis(),
  groupBy: vi.fn().mockReturnThis(),
  having: vi.fn().mockReturnThis(),
  update: vi.fn().mockReturnThis(),
  set: vi.fn().mockReturnThis(),
  delete: vi.fn().mockReturnThis(),
  onConflictDoNothing: vi.fn().mockReturnThis(),
  onConflictDoUpdate: vi.fn().mockReturnThis(),
  execute: vi.fn().mockResolvedValue([]),
  transaction: vi.fn().mockImplementation(async (callback) => callback(db)),
  query: new Proxy(
    {},
    {
      get(_target, _tableName: string) {
        return {
          findFirst: vi.fn().mockResolvedValue(null),
          findMany: vi.fn().mockResolvedValue([]),
        };
      },
    }
  ),
};

// Export Database type (mock version)
export type Database = typeof db;

// RLS scope helpers — passthroughs in tests (RLS_ENABLED=false equivalent).
// Each helper calls the operation with the provided db option, or the module-
// level mock db if none is passed. This lets test code that passes a local
// createMockDatabase() instance continue to work after services wrap their
// DB work in withOrgScope / withSystemScope.
export const withOrgScope = async <T>(
  operation: (tx: unknown) => Promise<T>,
  options?: { db?: unknown }
): Promise<T> => operation(options?.db ?? db);

export const withPublicOrgScope = async <T>(
  _organizationId: string,
  operation: (tx: unknown) => Promise<T>,
  options?: { db?: unknown }
): Promise<T> => operation(options?.db ?? db);

export const withSystemScope = async <T>(
  operation: (conn: unknown) => Promise<T>,
  options?: { db?: unknown }
): Promise<T> => operation(options?.db ?? db);

export const withPatientScope = async <T>(
  _context: { leadId: string; organizationId: string },
  operation: (tx: unknown) => Promise<T>,
  options?: { db?: unknown }
): Promise<T> => operation(options?.db ?? db);
