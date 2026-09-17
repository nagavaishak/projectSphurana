// Minimal HTTP client — local replacement for `@borradh-workspace/api-client`.
// The marketing app only calls three public booking endpoints, so it does
// not need the full workspace client (which transitively pulls in the
// entire backend `features` + `database` packages).

function getApiUrl(): string {
  if (typeof window !== 'undefined' && window.__CONFIG__?.apiUrl) {
    return window.__CONFIG__.apiUrl;
  }
  return '';
}

async function request<T>(
  method: string,
  path: string,
  body?: unknown
): Promise<T> {
  const base = getApiUrl().replace(/\/$/, '');
  const url = `${base}/${path.replace(/^\//, '')}`;

  const res = await fetch(url, {
    method,
    credentials: 'include',
    headers:
      body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  if (!res.ok) {
    // For server errors never surface internal detail; mirror the behaviour
    // of the original ky-based client.
    let message =
      res.status >= 500 ? 'An unexpected error occurred' : res.statusText;
    if (res.status < 500) {
      try {
        const data = (await res.clone().json()) as Record<string, unknown>;
        const errObj = data.error as { message?: string } | undefined;
        if (errObj && typeof errObj.message === 'string') {
          message = errObj.message;
        } else if (typeof data.message === 'string') {
          message = data.message;
        }
      } catch {
        /* response was not JSON */
      }
    }
    throw new Error(message || `Request failed (${res.status})`);
  }

  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export const apiClient = {
  get: <T>(path: string) => request<T>('GET', path),
  post: <T>(path: string, data?: unknown) => request<T>('POST', path, data),
  put: <T>(path: string, data?: unknown) => request<T>('PUT', path, data),
  patch: <T>(path: string, data?: unknown) => request<T>('PATCH', path, data),
  delete: <T>(path: string, data?: unknown) => request<T>('DELETE', path, data),
};
