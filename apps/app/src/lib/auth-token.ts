/**
 * Bearer-token storage for the Capacitor app.
 *
 * Holds the active access token in memory for the API client and mirrors
 * writes to `capacitor-secure-storage-plugin` (Keychain on iOS, EncryptedSharedPreferences
 * on Android, localStorage on web). The persisted copy lets the app survive
 * force-quit + restart without forcing the user to re-sign-in — `rehydrateAuthToken`
 * is called at startup before the first session query fires.
 *
 * The backend (`apps/api`) currently uses better-auth's bearer plugin and
 * returns a single long-lived access token from `auth/sign-in` — no refresh
 * token is issued. When that lands, this module is the right place for the
 * refresh handshake (see `apps/app/src/lib/api-client.ts`'s `onError` 401 hook).
 */

import { getItem, removeItem, setItem } from '@/lib/secure-storage';
import { markSessionAuthenticated } from '@/lib/session-lifecycle';

const ACCESS_TOKEN_KEY = 'borradh.auth.accessToken';

let inMemoryToken: string | undefined;
let rehydrated = false;

const listeners = new Set<(token: string | undefined) => void>();

export function getAuthToken(): string | undefined {
  return inMemoryToken;
}

export function setAuthToken(token: string | undefined): void {
  inMemoryToken = token;
  if (token) {
    markSessionAuthenticated();
    void setItem(ACCESS_TOKEN_KEY, token).catch(() => {
      // Secure storage unavailable (e.g., uninitialised on web) — in-memory
      // token still serves the current session.
    });
  } else {
    void removeItem(ACCESS_TOKEN_KEY).catch(() => {});
  }
  for (const listener of listeners) {
    listener(token);
  }
}

/**
 * Install a token and resolve only once the persisted copy is written.
 *
 * `setAuthToken` fires the storage write and returns immediately, which is
 * fine when the caller stays on the page. Callers that hard-navigate straight
 * afterwards (impersonate / stop-impersonating) must await this instead: a
 * reload that beats the write would rehydrate the PREVIOUS token and undo the
 * identity swap.
 */
export async function setAuthTokenAndPersist(token: string): Promise<void> {
  inMemoryToken = token;
  markSessionAuthenticated();
  try {
    await setItem(ACCESS_TOKEN_KEY, token);
  } catch {
    // Secure storage unavailable — the in-memory token still serves this page.
  }
  for (const listener of listeners) {
    listener(token);
  }
}

export function clearAuthToken(): void {
  setAuthToken(undefined);
}

export function onAuthTokenChange(
  listener: (token: string | undefined) => void
): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * Restore the persisted access token into memory. Called once at app startup
 * before the first session query — without it a cold-launch fires `auth/session`
 * with no bearer and the API responds 401, forcing the user back to sign-in.
 */
export async function rehydrateAuthToken(): Promise<void> {
  if (rehydrated) return;
  rehydrated = true;
  const stored = await getItem(ACCESS_TOKEN_KEY);
  if (stored) {
    inMemoryToken = stored;
    for (const listener of listeners) {
      listener(stored);
    }
  }
}
