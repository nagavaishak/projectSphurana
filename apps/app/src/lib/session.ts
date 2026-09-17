import { apiClient } from '@borradh-workspace/api-client';
import { queryOptions, useQuery } from '@tanstack/react-query';

import { queryClient } from '@/lib/query-client';
import { queryKeys } from '@/lib/query-keys';

export interface SessionUser {
  id: string;
  email: string;
  name?: string;
  image?: string | null;
  emailVerified?: boolean;
  role?: 'user' | 'admin';
  twoFactorEnabled?: boolean;
}

export interface SessionData {
  id?: string;
  expiresAt?: string;
  activeOrganizationId?: string;
  impersonatedBy?: string;
  intercomJwt?: string;
}

export interface SessionResponse {
  user: SessionUser | null;
  session: SessionData | null;
  /**
   * The session could not be FETCHED (timeout / 5xx / offline). Distinct from
   * `user: null`, which is the server positively saying "signed out". Never
   * redirect to `/sign-in` on this — the session may be perfectly valid.
   */
  unavailable?: boolean;
}

export const sessionQueryOptions = queryOptions({
  queryKey: queryKeys.auth.session(),
  queryFn: () => apiClient.get<SessionResponse>('auth/session'),
  staleTime: 30 * 1000,
});

export function useSession() {
  return useQuery(sessionQueryOptions);
}

/**
 * Cold-boot session gate for route `beforeLoad`.
 *
 * `beforeLoad` blocks the first paint until this resolves, so it must be
 * bounded: the shared api-client defaults to a 30s timeout with 2 retries,
 * which lets a slow/unreachable API stall the boot for ~90s behind a blank
 * screen (see the native WebView boot-smoke flake). So each attempt is short.
 *
 * CRITICAL: `GET auth/session` answers **200 `{ user: null }`** when the caller
 * is signed out — it never errors for that. A THROWN error is therefore always
 * transport/server failure (timeout, 5xx, offline), never a sign-out. Treating
 * one as "signed out" is what let a single slow response log a user out and
 * bounce them off a protected route: under load the preview API returned 504s
 * and whole e2e suites died on the sign-in page.
 *
 * So: retry a failure briefly, and if it still won't resolve report
 * `unavailable` rather than a fabricated signed-out session. Callers that guard
 * a protected route surface a retry (see `_authed`); they must NOT redirect to
 * `/sign-in`, which would destroy a perfectly good session.
 */
const BOOT_SESSION_TIMEOUT_MS = 8000;
/** Backoffs between boot attempts; length + 1 = total attempts. */
const BOOT_RETRY_DELAYS_MS = [250, 750];

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export async function ensureSession(): Promise<SessionResponse> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await queryClient.ensureQueryData({
        ...sessionQueryOptions,
        // Bound ky's per-request retry AND React Query's query-level retry (the
        // shared default retries twice with backoff, which on a stalled API
        // compounds to ~10s+ of blank boot). Retrying is handled here instead.
        retry: false,
        queryFn: () =>
          apiClient.get<SessionResponse>('auth/session', {
            timeout: BOOT_SESSION_TIMEOUT_MS,
            retry: 0,
          }),
      });
    } catch {
      if (attempt >= BOOT_RETRY_DELAYS_MS.length) {
        return { user: null, session: null, unavailable: true };
      }
      // Drop the rejected query so the next attempt refetches rather than
      // replaying the cached rejection.
      queryClient.removeQueries({ queryKey: sessionQueryOptions.queryKey });
      await delay(BOOT_RETRY_DELAYS_MS[attempt]);
    }
  }
}

export async function refetchSession(): Promise<SessionResponse> {
  await queryClient.invalidateQueries({
    queryKey: sessionQueryOptions.queryKey,
  });
  return queryClient.fetchQuery(sessionQueryOptions);
}

export function clearSessionCache(): void {
  queryClient.setQueryData(sessionQueryOptions.queryKey, {
    user: null,
    session: null,
  } satisfies SessionResponse);
}
