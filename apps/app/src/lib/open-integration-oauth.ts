import { apiClient } from '@borradh-workspace/api-client';
import { Browser } from '@capacitor/browser';
import { Capacitor, CapacitorHttp } from '@capacitor/core';
import { toast } from 'sonner';

import { getAuthToken } from '@/lib/auth-token';
import { resolveApiUrl } from '@/lib/resolve-api-url';

function readLocationHeader(
  headers: Record<string, string> | undefined
): string | null {
  if (!headers) return null;
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === 'location' && value) {
      return value;
    }
  }
  return null;
}

/**
 * Opens an integration OAuth flow.
 *
 * Browser: navigates to the API auth route (session cookies may apply on same-site).
 *
 * Capacitor: the API auth route requires `AuthGuard` (Bearer token). A full-page
 * `window.location` navigation cannot attach Authorization headers, so we issue an
 * authenticated native HTTP request, read the 302 `Location` (provider OAuth URL),
 * and open it in the system browser (same pattern as apps/mobile billing portal).
 */
async function openAuthenticatedOAuthUrl(apiAuthUrl: string): Promise<void> {
  if (!Capacitor.isNativePlatform()) {
    // Browser: same-site session cookie travels automatically; no bearer needed.
    window.location.href = apiAuthUrl;
    return;
  }

  const token = getAuthToken();
  if (!token) {
    toast.error('Please sign in again to connect this integration.');
    return;
  }

  try {
    const response = await CapacitorHttp.request({
      url: apiAuthUrl,
      method: 'GET',
      headers: {
        Authorization: `Bearer ${token}`,
        'X-Client-Type': 'mobile',
      },
      disableRedirects: true,
    });

    const redirectUrl =
      readLocationHeader(response.headers) ??
      (response.status >= 300 && response.status < 400 ? response.url : null) ??
      (response.status >= 200 && response.status < 400 ? response.url : null);

    if (redirectUrl && redirectUrl !== apiAuthUrl) {
      await Browser.open({ url: redirectUrl });
      return;
    }

    toast.error('Could not start the connection flow. Please try again.');
  } catch (error) {
    console.error('[openIntegrationOAuth]', error);
    toast.error('Could not start the connection flow. Please try again.');
  }
}

/** Path under the API base, e.g. `integrations/meta-ads/auth?returnTo=...` */
export function openIntegrationOAuth(pathWithQuery: string): Promise<void> {
  return openAuthenticatedOAuthUrl(resolveApiUrl(pathWithQuery));
}

/**
 * Start an integration OAuth flow via an authenticated API call.
 *
 * Preferred over {@link openIntegrationOAuth} for browser flows. The SPA
 * authenticates with a Bearer token (cookies are only a fallback), but a
 * full-page navigation to a guarded `…/auth` redirect endpoint can carry *only*
 * cookies — so users whose session cookie has lapsed hit a 401 even though the
 * app is still signed in (and they see the raw API JSON error). Instead we GET
 * the provider authorize URL as JSON (Bearer attached by the api-client), then
 * redirect the browser to it. Works identically on web and Capacitor.
 *
 * @param authorizeUrlPath API path returning `{ url }`, e.g.
 *   `integrations/instagram/authorize-url`.
 */
export async function startIntegrationOAuth(
  authorizeUrlPath: string
): Promise<void> {
  try {
    const { url } = await apiClient.get<{ url: string }>(authorizeUrlPath);
    if (!url) {
      toast.error('Could not start the connection flow. Please try again.');
      return;
    }
    await openProviderOAuthUrl(url);
  } catch (error) {
    const status = (error as { response?: { status?: number } } | undefined)
      ?.response?.status;
    if (status === 401) {
      toast.error('Your session expired — please sign in again to connect.');
    } else {
      console.error('[startIntegrationOAuth]', error);
      toast.error('Could not start the connection flow. Please try again.');
    }
  }
}

/** Full API auth URL from `resolveApiUrl(...)`. */
export function openIntegrationOAuthUrl(apiAuthUrl: string): Promise<void> {
  return openAuthenticatedOAuthUrl(apiAuthUrl);
}

/**
 * Opens a provider OAuth URL returned from an authenticated API call
 * (e.g. Stripe Connect `authUrl`). On Capacitor uses the system browser.
 */
export async function openProviderOAuthUrl(url: string): Promise<void> {
  if (!Capacitor.isNativePlatform()) {
    window.location.href = url;
    return;
  }
  await Browser.open({ url });
}
