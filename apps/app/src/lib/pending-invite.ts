/**
 * Pending team-member invite token, parked across the sign-up → accept bridge.
 *
 * The invited-member accept flow (`/accept-invitation?token=…`) stashes the
 * token here before it creates the account, so that any auth route that runs
 * `getPostAuthRedirect` mid-flow (e.g. a refresh that lands on `/sign-in`)
 * routes the fresh, org-less signup back to the accept flow instead of dumping
 * them into the *owner* onboarding at `/welcome`. Cleared once the invite is
 * accepted.
 */
const PENDING_INVITE_TOKEN_KEY = 'borradh:pending-invite-token';

export function setPendingInviteToken(token: string): void {
  if (typeof window === 'undefined') return;
  try {
    window.sessionStorage.setItem(PENDING_INVITE_TOKEN_KEY, token);
  } catch {
    // sessionStorage can throw in private-mode/native WebViews — best effort.
  }
}

export function getPendingInviteToken(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    return window.sessionStorage.getItem(PENDING_INVITE_TOKEN_KEY);
  } catch {
    return null;
  }
}

export function clearPendingInviteToken(): void {
  if (typeof window === 'undefined') return;
  try {
    window.sessionStorage.removeItem(PENDING_INVITE_TOKEN_KEY);
  } catch {
    // no-op
  }
}
