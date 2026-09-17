/**
 * What should an authed portal page render right now?
 *
 * Pure decision function, extracted from the copy-pasted gate that opened
 * every authed route in apps/app (`if (isError || !patient) { if (401 ||
 * !error) <Navigate to=sign-in/> … }`). Extracted because it is the one piece
 * of the port whose bugs are invisible: a wrong branch here either strands a
 * signed-out customer on a skeleton forever, or bounces a signed-IN customer
 * to sign-in on a transient 500 — and neither shows up in a build or a
 * typecheck. So it is a function with tests rather than a shape repeated six
 * times.
 */
import { getErrorStatus } from './api/paths';

export type AuthGateDecision =
  /** Still resolving `patient/me` — show the page skeleton. */
  | { kind: 'loading' }
  /** No usable session. Send them to this microsite's sign-in. */
  | { kind: 'redirect-to-sign-in' }
  /** The session may be fine; the request failed. Offer a retry. */
  | { kind: 'error' }
  /** Signed in — render the page. */
  | { kind: 'ready' };

export interface AuthGateInput {
  isLoading: boolean;
  isError: boolean;
  error: unknown;
  patient: unknown;
}

export function decideAuthGate({
  isLoading,
  isError,
  error,
  patient,
}: AuthGateInput): AuthGateDecision {
  if (isLoading) return { kind: 'loading' };
  if (!isError && patient) return { kind: 'ready' };

  const status = getErrorStatus(error);

  // 401 is the only status that means "not signed in". 403 does NOT: it means
  // the session is valid but this clinic isn't yours, and bouncing to a
  // sign-in the customer is already signed in to is an infinite loop.
  if (status === 401) return { kind: 'redirect-to-sign-in' };

  // No error at all, yet no patient: the query resolved to an empty body.
  // Treat as signed-out — there is nothing to render and no failure to retry.
  if (!error && !patient) return { kind: 'redirect-to-sign-in' };

  return { kind: 'error' };
}
