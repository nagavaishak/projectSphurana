// shared/core — the STABLE, dependency-clean core of the features shared layer.
//
// This barrel is the future `@borradh-workspace/features-shared-core` leaf
// package. Everything under `core/` must import ONLY from:
//   - other files within `core/`
//   - external npm packages (zod, drizzle-orm, …)
//   - other leaf workspace packages (@borradh-workspace/database, /labels,
//     /observability)
//
// It must NEVER import a domain-flavored shared helper (currency, meta
// targeting, notion, loops, flfb flags, sample-assets, …) or any feature
// domain. The `architecture/shared-core-isolation.test.ts` statically enforces
// this so the core stays extractable as a leaf package.

// Error handling + Result<T>
export {
  FeatureError,
  ok,
  err,
  ErrorCodes,
  internalError,
  isExclusionViolation,
} from './errors.js';
export type {
  Result,
  ExtractData,
  ExtractError,
  ErrorCode,
} from './errors.js';

// Branded primitives (money + entity IDs)
export {
  cents,
  addCents,
  subCents,
  multiplyCents,
  zCents,
  zId,
} from './branded.js';
export type {
  Cents,
  Id,
  OrganizationId,
  LeadId,
  UserId,
  AppointmentId,
  PractitionerId,
  ServiceId,
} from './branded.js';

// Base shared types (DB connection, pagination, service context)
export type {
  Database,
  Transaction,
  DbConnection,
  ServiceContext,
  PaginationParams,
  PaginatedResult,
  SortDirection,
  BaseEntity,
} from './types.js';

// Soft-delete primitives
export {
  notDeleted,
  softDeleteOrgChildren,
  softDeleteLeadChildren,
} from './soft-delete.js';

// Audit / conversation-event logging primitives
export {
  logAuditEvent,
  type AuditEventInput,
  logConversationEvent,
  type ConversationEvent,
  logFirstTouchOutcome,
} from './audit.js';

// Organization context plumbing (org country / context blocks for prompts).
// NOTE: `getOrgCurrency` is intentionally NOT here — it depends on the
// domain-flavored currency helper and lives in `../currency-for-country.js`.
export {
  getOrgCountry,
  getOrgContext,
  buildOrgContextBlock,
  type OrgContext,
  type OrgServiceContext,
} from './org-context.js';
