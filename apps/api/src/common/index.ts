// Guards
export {
  AuthGuard,
  Public,
  type AuthenticatedRequest,
} from './guards/auth.guard';
export {
  ApiKeyGuard,
  type ApiKeyAuthenticatedRequest,
} from './guards/api-key.guard';
export { ActiveOrgParamGuard } from './guards/active-org-param.guard';
export {
  PatientAuthGuard,
  type PatientPrincipal,
  type PatientRequest,
} from './guards/patient-auth.guard';
export { ActiveOrganizationGuard } from './guards/active-organization.guard';
export { MicrositeEditorGuard } from './guards/microsite-editor.guard';
export { AdminGuard } from './guards/admin.guard';
export { ClaireAccessGuard } from './guards/claire-access.guard';
export { GlobalAdminGuard } from './guards/global-admin.guard';
export { MemberGuard } from './guards/member.guard';
export { LocationGuard, LOCATION_HEADER } from './guards/location.guard';
export { NonProductionGuard } from './guards/non-production.guard';
export { PaidPlanGuard } from './guards/paid-plan.guard';
export { ScopeGuard } from './guards/scope.guard';
export { PlanAccessGuard } from './guards/plan-access.guard';
export { RoleGuard } from './guards/role.guard';
export { VideoOwnershipGuard } from './guards/video-ownership.guard';
export {
  hasPermission,
  hasMinimumRole,
  ROLE_PERMISSIONS,
} from './guards/permissions';

// Decorators
export { CurrentPatient } from './decorators/current-patient.decorator';
export { CurrentUser } from './decorators/current-user.decorator';
export { SessionToken } from './decorators/session-token.decorator';
export { SessionCookie } from './decorators/session-cookie.decorator';
export { IsMobileClient } from './decorators/is-mobile-client.decorator';
export { RawCookieHeader } from './decorators/raw-cookie-header.decorator';
export { ActiveOrganization } from './decorators/active-organization.decorator';
export { ActiveLocation } from './decorators/active-location.decorator';
export {
  WhatsappDelivery,
  type WhatsappDeliveryTag,
} from './decorators/whatsapp-delivery.decorator';
export { ApiKeyOrganization } from './decorators/api-key-organization.decorator';
export { CanManageOthers } from './decorators/can-manage-others.decorator';
export { ConnectedStripeAccount } from './decorators/connected-stripe-account.decorator';
export { RequireScopes } from './decorators/require-scopes.decorator';
export { RequirePermission } from './decorators/require-permission.decorator';
export { RequireRole } from './decorators/require-role.decorator';
export { SkipPaidPlanCheck } from './decorators/skip-paid-plan-check.decorator';
export { SkipMemberCheck } from './decorators/skip-member-check.decorator';
export {
  ResponseContract,
  RESPONSE_CONTRACT_KEY,
  type ResponseContractSchema,
} from './decorators/response-contract.decorator';

// OAuth callback transport (param decorator + guard + interceptor + filter).
// Grouped in one folder because the four pieces only make sense together: they
// are what lets an unauthenticated provider callback be verified AND thin.
export {
  OAUTH_PROVIDER_KEY,
  OAuthCallback,
  OAuthRedirectInterceptor,
  OAuthState,
  OAuthStateError,
  OAuthStateExceptionFilter,
  OAuthStateGuard,
  type OAuthStateRequest,
  webOrigin,
} from './oauth';

// Session-cookie transport (param decorators + response shaping). Grouped for
// the same reason as `oauth` below: reading, writing and forwarding Better
// Auth's cookies only makes sense as one piece, and both the auth and
// admin-terminal controllers must issue byte-identical cookies.
export {
  ANONYMOUS_SESSION_PAYLOAD,
  applySessionSetCookies,
  buildSessionPayload,
  clearSessionCookie,
  extractSessionToken,
  extractTwoFactorCookiePair,
  forwardSetCookieHeaders,
  isMobileClient,
  sendTwoFactorChallenge,
  setAdmin2faCookie,
  setSessionCookie,
} from './session';

// Media URL signing primitives shared by the response-shaping paths that the
// `@MediaUrls` interceptor's dot-path walker cannot express (nested arrays).
export {
  extractCdnKey,
  signCdnUrl,
  signGraphicOutputList,
  signGraphicOutputs,
} from './media';

// Filters
export { SanitizeErrorsFilter } from './filters';

// Interceptors
export {
  PaidPlanInterceptor,
  RlsInterceptor,
  ResponseContractInterceptor,
  ResponseContractError,
  RESPONSE_PARSE_STRICT_FLAG,
  RESPONSE_CONTRACT_FLAG_PROVIDER,
} from './interceptors';

// Middleware
export * from './middleware';
