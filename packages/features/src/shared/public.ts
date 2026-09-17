/**
 * Public-facing barrel for `@borradh-workspace/features/shared`.
 *
 * This file is the package-export entry point (see package.json `"./shared"`).
 * It re-exports everything from `./index.js` that is safe for frontend/mobile
 * bundles. Server-only utilities that transitively import
 * `@borradh-workspace/database` (and therefore `postgres`) are excluded:
 *
 *   - notDeleted, softDeleteOrgChildren, softDeleteLeadChildren  (soft-delete.js)
 *   - logAuditEvent                                               (audit.js)
 *
 * Internal service code within packages/features still imports from
 * `../shared/index.js` which includes everything.
 */

// Error handling
export {
  FeatureError,
  ok,
  err,
  ErrorCodes,
  internalError,
} from './core/errors.js';

export type {
  Result,
  ExtractData,
  ExtractError,
  ErrorCode,
} from './core/errors.js';

// Server-built links back into the dashboard (emails, notifications). Pure
// string building — no database import — so it is safe in this barrel.
export {
  conversationInboxPath,
  conversationInboxUrl,
} from './dashboard-links.js';

// Branded primitives (money + entity IDs) — safe for frontend/mobile bundles
export {
  cents,
  addCents,
  subCents,
  multiplyCents,
  zCents,
  zId,
} from './core/branded.js';
export type {
  Cents,
  Id,
  OrganizationId,
  LeadId,
  UserId,
  AppointmentId,
  PractitionerId,
  ServiceId,
} from './core/branded.js';

// Types
export type {
  Database,
  Transaction,
  DbConnection,
  ServiceContext,
  PaginationParams,
  PaginatedResult,
  SortDirection,
  BaseEntity,
} from './core/types.js';

// Business hours utilities
export {
  DEFAULT_BUSINESS_HOURS,
  toMinutes,
  fromMinutes,
  isWithinBusinessHours,
  getNextBusinessHoursTime,
  scheduleWithinBusinessHours,
  calculateNextActionTime,
  hasBusinessHoursConfigured,
} from './business-hours.js';

export type { BusinessHours } from './business-hours.js';

// Which zone a business runs in, from its primary location. Pure — `tz-lookup`
// is an offline table, no database import — so it is safe for any bundle, and
// sharing it is the point: the backfill script and the runtime must not carry
// two different answers to the same question.
export {
  timezoneForLocation,
  MULTI_ZONE_COUNTRIES,
  formatInOrgZone,
  formatTimeInOrgZone,
  formatDateInOrgZone,
  orgDayString,
  // Wall-clock -> instant. Exported so callers that reason about an org's
  // calendar DAY (Claire's availability diagnosis, in particular) resolve its
  // boundaries with the same function the slot maths uses, rather than
  // re-deriving zone offsets and drifting by an hour twice a year.
  zonedWallTimeToUtc,
} from './timezone.js';
export type { LocationLike, OrgTimeZone } from './timezone.js';

// Date-expression resolver — pure `Intl`-based, safe for any bundle.
export {
  RANGE_PRESETS,
  addDays,
  addMonths,
  describeToday,
  resolveDateExpression,
  resolveDateOnly,
  resolveDateTime,
  resolveRangePreset,
  todayInTimezone,
} from './resolve-date/index.js';
export type {
  RangePreset,
  ResolveDateOptions,
  ResolvedDate,
} from './resolve-date/index.js';

// Pure currency helpers (symbol/code/formatting). Safe for the browser —
// `getOrgCurrency` (DB-backed) stays in ./currency-for-country.js and is not
// exported here.
export {
  currencyForCode,
  currencyForCountry,
  currencyMinorUnitDigits,
  formatPrice,
  type Currency,
} from './currency.js';

// Meta targeting builder
export { buildMetaTargeting } from './build-meta-targeting.js';

// EU targeting detection
export { targetingIncludesEU } from './eu-targeting.js';

// Labels and enum exports (re-exported from database for api-client consumption)
export * from './labels.js';

// OAuth `state` signing + redirect outcomes are SERVER-ONLY and deliberately
// NOT exported here: oauth-state.ts imports `node:crypto`, and this barrel is
// bundled for the browser. Reach them at
// `@borradh-workspace/features/shared/oauth` instead.

// Query-string boolean coercion. Pure zod, no database — safe for any bundle.
export { queryBoolean } from './query-boolean.js';

// The vocabulary of "things a website scan can be about". The settings scan UI
// renders one checkbox per section, so this list has to reach the browser —
// but the schema module that defines it sits behind the website-analysis
// barrel, which drags in the scraping strategies (and `@logtail/node` via
// observability). Re-exported here so frontend bundles get the seven strings
// without the crawler.
export {
  analysisSectionValues,
  type AnalysisSection,
} from '../website-analysis/services/analyze-website/analysis-sections.js';
