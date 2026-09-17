/**
 * Why a domain claim did not succeed — and, crucially, WHO has to do something
 * about it.
 *
 * The three non-transient reasons need three completely different human
 * actions, and collapsing them into "Meta call failed" is what turns this into
 * a support ticket nobody can route:
 *
 *   - `already_owned_elsewhere` — the domain is claimed in a DIFFERENT Business
 *     Manager (usually the customer's old agency, or their own personal BM).
 *     Meta allows exactly one owning business per domain, so retrying is
 *     futile forever. Someone has to release it there, or verify from there.
 *   - `business_not_verified` — the tenant's Business Manager has not completed
 *     Meta's Business Verification, which gates this API entirely. The domain
 *     is fine; the account is not. Nothing about the domain can proceed until
 *     the tenant finishes verification with Meta.
 *   - `permission_denied` — our token lacks the scope / the connected user is
 *     not an admin of the business. A reconnect with the right role fixes it.
 *
 * Everything else is `transient` — Meta 500s, rate limits, timeouts — and the
 * poller's existing retry is the correct response. That distinction is the
 * whole point of this file: a transient failure must NEVER page a human, and a
 * conflict must never be silently retried for seven days.
 */

import { MetaApiError } from '../shared/meta-api-error.js';

export type MetaOwnedDomainFailureReason =
  | 'already_owned_elsewhere'
  | 'business_not_verified'
  | 'permission_denied'
  | 'transient';

export class MetaOwnedDomainError extends Error {
  readonly reason: MetaOwnedDomainFailureReason;
  /** The underlying Meta error, when there was one. Never carries a token. */
  readonly metaError?: MetaApiError;

  constructor(
    reason: MetaOwnedDomainFailureReason,
    message: string,
    metaError?: MetaApiError
  ) {
    super(message);
    this.name = 'MetaOwnedDomainError';
    this.reason = reason;
    this.metaError = metaError;
  }

  /** A retry can only ever help for this one. */
  get isRetryable(): boolean {
    return this.reason === 'transient';
  }
}

/**
 * Meta does not give these conditions clean, stable subcodes on this edge —
 * the same numeric code (100 / 200) covers a dozen unrelated causes — so the
 * message text is the only reliable discriminator, with the registry's
 * category as the fallback. Matching is deliberately broad: a MISSED conflict
 * degrades to "transient", which the poller retries harmlessly, whereas a
 * false conflict would email a customer about a problem they do not have.
 */
const ALREADY_OWNED =
  /already (been )?(claimed|owned|added|verified)|owned by (another|a different|some other)|belongs to (another|a different)|another business/i;

const BUSINESS_UNVERIFIED =
  /business (is not|isn'?t|must be|needs to be|has not been) verified|business verification|verify your business|unverified business/i;

export const classifyOwnedDomainError = (
  error: unknown
): MetaOwnedDomainFailureReason => {
  if (!(error instanceof MetaApiError)) return 'transient';

  const text = `${error.message} ${error.userMessage ?? ''}`;

  // Order matters. A business-verification block is frequently ALSO reported
  // as a permission error; the specific reason is the actionable one.
  if (BUSINESS_UNVERIFIED.test(text)) return 'business_not_verified';
  if (ALREADY_OWNED.test(text)) return 'already_owned_elsewhere';
  if (error.isPermissionError || error.isAuthError) return 'permission_denied';

  return 'transient';
};

export const toOwnedDomainError = (
  error: unknown,
  fallbackMessage: string
): MetaOwnedDomainError => {
  if (error instanceof MetaOwnedDomainError) return error;
  const reason = classifyOwnedDomainError(error);
  const metaError = error instanceof MetaApiError ? error : undefined;
  return new MetaOwnedDomainError(
    reason,
    metaError?.message ?? fallbackMessage,
    metaError
  );
};
