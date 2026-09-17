/**
 * Absolute URL to the Nest API for a path (leading slash optional).
 *
 * Next.js maps `/nest/:path*` → `${API_URL}/:path*`. The Vite app talks to Nest
 * directly via the runtime-config `apiUrl` (same base as `apiClient`), so
 * callers should pass the **post-rewrite** path (e.g. `leads/export`, not
 * `nest/leads/export`).
 *
 * **Full-page redirects (OAuth):** if `apiUrl` is a relative path (e.g.
 * `/nest`), the browser resolves it on the **SPA origin** (e.g. localhost:5173).
 * Vite does not proxy `/nest` by default, so use an **absolute** API URL in
 * local config (e.g. `http://localhost:3001`) for OAuth flows, or add a dev proxy.
 *
 * Reads from `window.__CONFIG__` (written by `RuntimeConfigProvider`). Callers
 * must invoke this only after the provider has resolved; in practice that
 * means anywhere downstream of the provider in the tree.
 */
export function resolveApiUrl(pathWithQuery: string): string {
  const config = typeof window !== 'undefined' ? window.__CONFIG__ : undefined;
  const apiUrl = (config as { apiUrl?: string } | undefined)?.apiUrl;
  if (!apiUrl) {
    throw new Error('resolveApiUrl called before runtime config was loaded');
  }
  const path = pathWithQuery.replace(/^\//, '');
  const base = apiUrl.replace(/\/$/, '');
  if (/^https?:\/\//i.test(base)) {
    return `${base}/${path}`;
  }
  const prefix = base.startsWith('/') ? base : `/${base}`;
  const origin = typeof window !== 'undefined' ? window.location.origin : '';
  return `${origin}${prefix}/${path}`;
}
