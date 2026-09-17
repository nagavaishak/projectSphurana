/**
 * Session-cookie transport shared by the auth and admin-terminal controllers.
 *
 * Grouped in one folder for the same reason as `common/oauth`: reading,
 * writing and forwarding Better Auth's cookies only makes sense as one piece,
 * and every attribute has to stay byte-identical across both controllers or
 * users get silently signed out.
 */
export { setAdmin2faCookie } from './admin-2fa-cookie.js';
export {
  ANONYMOUS_SESSION_PAYLOAD,
  buildSessionPayload,
} from './session-payload.js';
export {
  applySessionSetCookies,
  clearSessionCookie,
  extractSessionToken,
  forwardSetCookieHeaders,
  isMobileClient,
  setSessionCookie,
} from './session-cookie.js';
export { type SessionSwapResult, sendSessionSwap } from './session-swap.js';
export {
  extractTwoFactorCookiePair,
  sendTwoFactorChallenge,
} from './two-factor-challenge.js';
export {
  PATIENT_SESSION_COOKIE,
  clearPatientSessionCookie,
  readPatientSessionTokenFromRequest,
  setPatientSessionCookie,
} from './patient-session-cookie.js';
