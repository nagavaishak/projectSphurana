// Schema exports
export * from './schema/index.js';

// Database client
export { db, testConnection } from './client.js';
export type { Database } from './client.js';

// Role-specific RLS pools (Phase 2 / I3). Default to `db` until an environment
// sets DATABASE_URL_AUTHENTICATED / _PUBLIC / _SYSTEM. The scope helpers below
// already default to the right one per role, so most code never imports these
// directly — they exist for explicit wiring/health checks.
export { dbAuthenticated, dbPublic, dbSystem } from './client.js';

// Transient connection-error retry (Neon/Fly resilience)
export { withDbRetry, isTransientDbError } from './retry.js';
export type { DbRetryOptions } from './retry.js';

// Constraint-violation detection (check-then-insert races)
export {
  isDeadlock,
  isExclusionViolation,
  isForeignKeyViolation,
  isUniqueViolation,
  mapDbError,
  pgViolation,
} from './constraints.js';
export type { PgViolationInfo } from './constraints.js';

// Test fixtures reproducing drizzle's wrapped Postgres-error shape. Pure data
// construction — no DB connection — safe to export alongside the client.
export {
  drizzleFkViolation,
  drizzleUniqueViolation,
} from './testing/pg-error.js';

// RLS (Row-Level Security) context utilities
export {
  // AsyncLocalStorage-based scope helpers (current)
  runWithRlsContext,
  getRlsContext,
  withOrgScope,
  withPublicOrgScope,
  withSystemScope,
  withPatientScope,
  type PatientScopeContext,
  // Legacy explicit-context helpers (retained for back-compat)
  withRlsContext,
  withBypassContext,
  setRlsContext,
  clearRlsContext,
  hasRlsContext,
  type RlsContext,
} from './rls-context.js';

// RLS policy helper for schema files (one line per org-scoped table)
export {
  orgRlsPolicy,
  appAuthenticated,
  appPublic,
  appSystem,
} from './rls-policy.js';

// Drizzle operators (re-exported for convenience)
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
} from 'drizzle-orm';

// `sql` is re-exported from a guarded wrapper (identical runtime behaviour)
// that rejects raw `Date` interpolation at compile time — the postgres-js
// driver throws ERR_INVALID_ARG_TYPE on a bound Date. See ./sql-tag.ts.
export { sql } from './sql-tag.js';
export type {
  GuardedSqlTag,
  GuardSqlDateParams,
  RawSqlDateParamNotAllowed,
} from './sql-tag.js';
