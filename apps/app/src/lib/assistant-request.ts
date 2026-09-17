import { getAuthToken } from '@/lib/auth-token';
import { resolveApiUrl } from '@/lib/resolve-api-url';

/**
 * Absolute Nest URL for `assistant/*` paths (replaces Next `/api/assistant/*`
 * same-origin proxy).
 */
export function assistantApiUrl(suffix: string): string {
  const s = suffix.replace(/^\//, '');
  return resolveApiUrl(`assistant/${s}`);
}

/**
 * `fetch` init aligned with `apiClient`: cookies + Bearer when the app has
 * stored an access token.
 */
export function assistantRequestInit(init?: RequestInit): RequestInit {
  const { headers: initHeaders, ...rest } = init ?? {};
  const headers = new Headers(initHeaders);
  const token = getAuthToken();
  if (token) {
    headers.set('Authorization', `Bearer ${token}`);
  }
  return {
    credentials: 'include',
    ...rest,
    headers,
  };
}
