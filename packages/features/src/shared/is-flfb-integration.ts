/**
 * Whether a Meta Ads integration runs on a NON-EXPIRING system-user token, as
 * opposed to a long-lived user token that has to be refreshed.
 *
 * Two connection methods produce one: `flfb` (Facebook Login for Business,
 * retired for new connections) and `system_user` (a token minted for a system
 * user in our own business portfolio, against assets the client shared with us
 * as a Partner). They differ only in how the token was obtained; every
 * downstream property this predicate exists to express is identical.
 *
 * Rows that predate the `connectionMethod` column (NULL) are inferred from the
 * absence of a token expiry — classic long-lived user tokens always carry one,
 * system-user tokens never do.
 *
 * Such integrations must NEVER be sent through token refresh/exchange
 * (`fb_exchange_token`); a revoked system-user token surfaces as a Meta
 * code-190 auth error and is handled by mark-needs-reconnect.
 *
 * The name is historical: it predates the system-user path and is load-bearing
 * at ~20 call sites. It reads as "is this the non-refreshable kind".
 */
export const isFlfbIntegration = (integration: {
  connectionMethod?: 'classic' | 'flfb' | 'system_user' | null;
  tokenExpiresAt?: Date | null;
}): boolean =>
  integration.connectionMethod === 'flfb' ||
  integration.connectionMethod === 'system_user' ||
  (integration.connectionMethod == null && integration.tokenExpiresAt == null);
