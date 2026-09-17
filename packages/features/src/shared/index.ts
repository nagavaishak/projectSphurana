export { findAdsUsingCreative } from './creative-in-use.js';
// Shared utilities for features package
//
// NOTE: This is the INTERNAL barrel — used by services within packages/features
// via relative imports (e.g. `../../../shared/index.js`). It includes server-only
// utilities that depend on @borradh-workspace/database.
//
// The EXTERNAL barrel consumed by api-client / frontend via
// `@borradh-workspace/features/shared` is `./public.ts`, which excludes
// server-only code to prevent `postgres` leaking into browser/mobile bundles.

// Session cookie name — one constant for every server-to-server Better Auth call
export {
  SESSION_COOKIE_NAME,
  buildSessionCookieHeaders,
} from './session-cookie-name.js';

// Error handling
export {
  FeatureError,
  ok,
  err,
  ErrorCodes,
  internalError,
  isExclusionViolation,
} from './core/errors.js';

export type {
  Result,
  ExtractData,
  ExtractError,
  ErrorCode,
} from './core/errors.js';

// Gemini returns HTTP 429 for both transient quota pressure and non-retryable
// billing caps. Keep this provider-specific distinction in one pure helper so
// callers, queue workers, and user-facing failure classification agree.
export { isGeminiBillingLimitError } from './core/gemini-billing-limit.js';

// Dev-only onboarding sample media (gated by ONBOARDING_SAMPLE_ASSETS)
export {
  sampleGraphicOutputs,
  sampleImageUrl,
  sampleThumbnailUrl,
  sampleVideo,
} from './sample-assets.js';

// Branded primitives (money + entity IDs) — see branded.ts for the rollout plan
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

// Timezone utilities (availability wall-clock ↔ UTC instant conversion, and
// resolving which zone a business runs in from its primary location)
export {
  zonedWallTimeToUtc,
  zonedHourMinute,
  zonedDateString,
  timezoneForLocation,
  formatInOrgZone,
  formatTimeInOrgZone,
  formatDateInOrgZone,
  orgDayString,
} from './timezone.js';
export type { LocationLike, OrgTimeZone } from './timezone.js';

export type { BusinessHours } from './business-hours.js';

// Date-expression resolver (real clock + org timezone → absolute dates).
// The single time source for date-bearing tool inputs and validation.
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

// Meta targeting builder
export {
  buildMetaTargeting,
  isNearNullIsland,
} from './build-meta-targeting.js';

// EU targeting detection
export { targetingIncludesEU } from './eu-targeting.js';

// Instagram FLfB routing kill-switch (default-off, per-org)
export {
  INSTAGRAM_FLFB_ROUTING_FLAG,
  isInstagramFlfbRoutingEnabled,
} from './instagram-flfb-flag.js';

// FLfB (system-user token) integration detection
export { isFlfbIntegration } from './is-flfb-integration.js';

// Built-in ("borradh") calendar detection + its booking link
export {
  canResolveAvailability,
  nativeBookingLink,
  usesNativeCalendar,
} from './native-calendar.js';
export {
  micrositeBookingBase,
  micrositeBookingUrl,
  micrositePortalBase,
  micrositeServiceBookingUrl,
} from './microsite-links.js';

// Server-built links back INTO the dashboard (emails, notifications). These
// stay un-prefixed on purpose — a conversation has no branch to name. See the
// module docstring.
export {
  conversationInboxPath,
  conversationInboxUrl,
} from './dashboard-links.js';

// Which host a tenant's public links are built on. Resolve ONCE per unit of
// work (`resolveMicrositeLinkTargets` for a batch) and pass the target to the
// builders above — they are pure, so no loop can hide a query per recipient.
export {
  pathTierLinkTarget,
  resolveMicrositeLinkTarget,
  resolveMicrositeLinkTargets,
  resolvePrimaryMicrositeDomain,
  type MicrositeLinkTarget,
} from './microsite-host.js';

// Currency resolution from org country. `currencyForCode` / `currencyForCountry`
// / `formatPrice` are pure; `getOrgCurrency` reads the org's primary location.
export {
  currencyForCode,
  currencyForCountry,
  currencyMinorUnitDigits,
  formatPrice,
  getOrgCurrency,
  type Currency,
} from './currency-for-country.js';

// Labels and enum exports (re-exported from database for api-client consumption)
export * from './labels.js';

// Authenticated OAuth `state` for provider connect callbacks. Lives in shared
// because BOTH the API controller and the features services that build the
// authorize URL (initiate-stripe-connect) must mint the same signed value.
export {
  OAUTH_STATE_MAX_AGE_MS,
  type OAuthStatePayload,
  safeReturnTo,
  signOAuthState,
  verifyOAuthState,
} from './oauth-state.js';
export {
  OAUTH_REDIRECT,
  type OAuthRedirectResult,
  externalRedirect,
  isOAuthRedirect,
  oauthRedirect,
} from './oauth-redirect.js';

export {
  notDeleted,
  softDeleteOrgChildren,
  softDeleteLeadChildren,
} from './core/soft-delete.js';
// Who may be booked, and by whom. CUSTOMER-facing (booking page, chatbot,
// voice) requires active + accepts-bookings + accepted-invitation + not
// deleted; STAFF-facing drops the accepts-bookings toggle but keeps the rest.
export {
  customerBookablePractitioner,
  isCustomerBookable,
  isStaffBookable,
  staffBookablePractitioner,
} from './core/bookable.js';
export {
  logAuditEvent,
  type AuditEventInput,
  logConversationEvent,
  logFirstTouchOutcome,
  type ConversationEvent,
} from './core/audit.js';

// Shared services (exchange rates, currency conversion) are NOT re-exported here
// to avoid pulling @borradh-workspace/observability → @sentry/node into frontend bundles.
// Import directly: import { getExchangeRates } from '../../../shared/services/index.js';

// Organization context helpers live in ./org-context.js — import directly
// from there to avoid pulling database/postgres into frontend bundles.

// Loops marketing helpers live in ./loops.js — import directly from there
// to avoid pulling server-side integrations into frontend bundles.

export { isUndeliverableEmail } from './undeliverable-email.js';
export { queryBoolean } from './query-boolean.js';

// Location scoping — the "zero join rows = everywhere" convention.
export {
  atLocationOrUnassigned,
  atLocationOrUnscoped,
  addLocationLinks,
  removeLocationLink,
} from './location-scope.js';

// Per-branch service pricing. Shared because four surfaces quote a price and
// every one of them must quote the SAME one.
export {
  applyServiceLocationOverride,
  applyVariantLocationOverride,
  loadServiceLocationOverrides,
  loadVariantLocationOverrides,
  type ServiceLocationOverride,
  type VariantLocationOverride,
} from './service-location-pricing.js';

// Public-facing service category display names (real category rows, with the
// legacy `category` enum label as the fallback).
export {
  loadServiceCategoryNames,
  serviceCategoryName,
} from './service-category-name.js';
