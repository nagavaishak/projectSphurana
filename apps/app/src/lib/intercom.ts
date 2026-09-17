/**
 * Intercom Support Chat for Capacitor.
 *
 * Replaces the Expo `@intercom/intercom-react-native` integration. Backed by
 * `@capacitor-community/intercom`, which wraps Intercom's native iOS + Android
 * SDKs. Plugin keys (appId / iosApiKey / androidApiKey) are configured in
 * `capacitor.config.ts` under `plugins.Intercom` and auto-loaded at native
 * init — no JS-side `loadWithKeys` call needed.
 *
 * All calls are wrapped in try/catch so Intercom errors never crash the app.
 * On non-native platforms (web preview) every helper is a no-op so the same
 * code paths run in browser dev without touching the bridge.
 */

import { Intercom } from '@capacitor-community/intercom';
import { Capacitor } from '@capacitor/core';

function isNative(): boolean {
  return Capacitor.isNativePlatform();
}

/**
 * Identify the current user with Intercom after sign-in or session restore.
 * Pass a JWT for identity verification when available.
 *
 * SDK methods return Promises — awaited so try/catch captures async rejections
 * instead of leaking them as unhandled rejections that Sentry reports as
 * crashes.
 */
export async function intercomLogin(
  userId: string,
  email?: string,
  name?: string,
  intercomJwt?: string
): Promise<void> {
  if (!isNative()) return;
  try {
    if (intercomJwt) {
      await Intercom.setUserJwt({ jwt: intercomJwt });
    }
    await Intercom.registerIdentifiedUser({ userId });
    if (email || name) {
      await Intercom.updateUser({ email, name });
    }
  } catch (error) {
    console.warn('[Intercom] Failed to login:', error);
  }
}

/**
 * Update user attributes (e.g., organization context, custom fields).
 */
export async function intercomUpdateUser(
  attributes: Record<string, string | number | boolean>
): Promise<void> {
  if (!isNative()) return;
  try {
    await Intercom.updateUser({ customAttributes: attributes });
  } catch (error) {
    console.warn('[Intercom] Failed to update user:', error);
  }
}

/**
 * Set the user's active organization as an Intercom Company.
 *
 * Note: `@capacitor-community/intercom` doesn't expose a `companies` field on
 * `IntercomUserUpdateOptions` (unlike `@intercom/intercom-react-native`). Until
 * that lands, push the org context onto `customAttributes` so support agents
 * can still segment by organization in the Intercom dashboard.
 */
export async function intercomSetCompany(company: {
  id: string;
  name: string;
}): Promise<void> {
  if (!isNative()) return;
  try {
    await Intercom.updateUser({
      customAttributes: {
        organization_id: company.id,
        organization_name: company.name,
      },
    });
  } catch (error) {
    console.warn('[Intercom] Failed to set company:', error);
  }
}

/**
 * Logout the current user from Intercom on sign-out.
 */
export async function intercomLogout(): Promise<void> {
  if (!isNative()) return;
  try {
    await Intercom.logout();
  } catch (error) {
    console.warn('[Intercom] Failed to logout:', error);
  }
}

/**
 * Open the Intercom messenger (chat with support).
 */
export async function openIntercomMessenger(): Promise<void> {
  if (!isNative()) return;
  try {
    await Intercom.displayMessenger();
  } catch (error) {
    console.warn('[Intercom] Failed to open messenger:', error);
  }
}

/**
 * Open the Intercom help center.
 */
export async function openIntercomHelpCenter(): Promise<void> {
  if (!isNative()) return;
  try {
    await Intercom.displayHelpCenter();
  } catch (error) {
    console.warn('[Intercom] Failed to open help center:', error);
  }
}

/**
 * Hide the default Intercom floating launcher button. Call once on app
 * startup to prevent it from conflicting with the app's own navigation.
 */
export async function hideIntercomLauncher(): Promise<void> {
  if (!isNative()) return;
  try {
    await Intercom.hideLauncher();
  } catch (error) {
    console.warn('[Intercom] Failed to hide launcher:', error);
  }
}

/**
 * Check if a notification payload is from Intercom.
 *
 * Used by the push delivery layer (`apps/app/src/lib/push.ts`) to route taps
 * correctly — Intercom pushes are handled by Intercom's own SDK, all others
 * route through the app's router.
 */
export function isIntercomPush(
  data: Record<string, unknown> | undefined
): boolean {
  if (!data) return false;
  return !!data.intercom_push_type;
}
