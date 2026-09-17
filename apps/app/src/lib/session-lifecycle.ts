/**
 * Coordinates the one-way transition from an authenticated app to sign-in
 * when the API proves that its session no longer exists.
 *
 * The API client cannot import the router directly: doing so creates an import
 * cycle through the generated route tree. Instead, app startup installs this
 * small boundary handler once the router and query client are available.
 */
type SessionInvalidationHandler = () => void;

let handler: SessionInvalidationHandler | undefined;
let invalidationHandled = false;

// This exact message is emitted by AuthGuard only after Better Auth rejects a
// presented token. It is deliberately narrower than a status-only check:
// other 401s can describe an authorization failure in a downstream product
// integration and must never sign the Borradh user out.
export const INVALID_SESSION_MESSAGE = 'Invalid or expired session';

export function isInvalidSessionError(error: {
  status: number;
  message: string;
}): boolean {
  return (
    error.status === 401 && error.message.trim() === INVALID_SESSION_MESSAGE
  );
}

export function registerSessionInvalidationHandler(
  nextHandler: SessionInvalidationHandler
): () => void {
  handler = nextHandler;
  return () => {
    if (handler === nextHandler) handler = undefined;
  };
}

/** Invoke the app-level recovery exactly once for one expired session. */
export function handleSessionInvalidation(): void {
  if (invalidationHandled) return;
  invalidationHandled = true;
  handler?.();
}

/** Allow a subsequent sign-in to install and later invalidate a new session. */
export function markSessionAuthenticated(): void {
  invalidationHandled = false;
}
