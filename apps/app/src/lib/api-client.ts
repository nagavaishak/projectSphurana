import { configureApiClient } from '@borradh-workspace/api-client';
import type { RuntimeConfig } from '@borradh-workspace/runtime-config/schema';

import { clearAuthToken, getAuthToken } from '@/lib/auth-token';
import {
  handleSessionInvalidation,
  isInvalidSessionError,
} from '@/lib/session-lifecycle';

let configured = false;
let apiBaseUrl: string | null = null;

/**
 * The apiUrl the shared client was configured with. Used by transports that
 * deliberately bypass the shared client (patient-portal auth — a second
 * principal whose bearer token must not collide with the staff
 * authProvider on the shared instance).
 */
export function getApiBaseUrl(): string | null {
  return apiBaseUrl;
}

export function configureApiClientForApp(config: RuntimeConfig): void {
  apiBaseUrl = config.apiUrl;
  if (configured) return;

  // Bearer-token auth for web + native. The API only returns a session token in
  // the sign-in body when `X-Client-Type: mobile` is set; without it, auth relies
  // on HttpOnly cookies. That works for same-site deploys (app.* + api.* under
  // one registrable domain) but breaks local Vite on localhost:5173 calling a
  // tunnel API — cross-site fetches don't send SameSite=Lax cookies, so
  // POST /auth/sign-in succeeds and GET /auth/session immediately returns null.
  configureApiClient({
    baseUrl: config.apiUrl,
    authProvider: async () => getAuthToken(),
    headers: { 'X-Client-Type': 'mobile' },
    onError: (error) => {
      if (isInvalidSessionError(error)) {
        clearAuthToken();
        // An expired bearer used to leave the user on the protected screen:
        // the individual request rejected as HTTPError, later being captured
        // by the global SDK. Move through the same explicit sign-out path
        // instead of treating a normal session lifecycle event as an app error.
        handleSessionInvalidation();
      }
    },
  });
  configured = true;
}
