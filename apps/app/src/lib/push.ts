/**
 * Push notifications for the Capacitor app.
 *
 * Replaces apps/mobile/src/lib/notifications.ts (Expo-based). On native iOS we
 * register with APNs and receive a raw 64-char device token; on native Android
 * we get an FCM registration token. The token is POSTed to the existing
 * `notifications/push-token` endpoint with `tokenType: 'apns' | 'fcm'` so the
 * server-side delivery layer (packages/features) can route to the right
 * provider. On web, push registration is a no-op.
 */

import { apiClient, getApiClientConfig } from '@borradh-workspace/api-client';
import { Intercom } from '@capacitor-community/intercom';
import { Capacitor } from '@capacitor/core';
import {
  type ActionPerformed,
  type PushNotificationSchema,
  PushNotifications,
  type RegistrationError,
  type Token,
} from '@capacitor/push-notifications';

import { logError } from '@/lib/log-error';

type Platform = 'ios' | 'android';
type TokenType = 'apns' | 'fcm';

interface NotificationHandlers {
  /** Tap from system tray (or notification center). Always fired in foreground or background. */
  onActionPerformed?: (notification: ActionPerformed) => void;
  /** Notification received while the app was in the foreground. */
  onReceived?: (notification: PushNotificationSchema) => void;
}

let registered = false;
let initPromise: Promise<string | null> | null = null;

/**
 * Request permission and register the device push token with the API.
 *
 * Idempotent: calling repeatedly returns the same in-flight promise (or
 * resolves to the cached token) so sign-in / app-foreground hooks can call
 * this without coordinating.
 */
export async function registerForPushNotifications(
  handlers?: NotificationHandlers
): Promise<string | null> {
  if (!Capacitor.isNativePlatform()) {
    return null;
  }
  if (initPromise) {
    return initPromise;
  }

  initPromise = (async () => {
    try {
      const platform = Capacitor.getPlatform() as Platform;
      const tokenType: TokenType = platform === 'ios' ? 'apns' : 'fcm';

      const existing = await PushNotifications.checkPermissions();
      let status = existing.receive;
      if (status === 'prompt' || status === 'prompt-with-rationale') {
        const req = await PushNotifications.requestPermissions();
        status = req.receive;
      }
      if (status !== 'granted') {
        return null;
      }

      // Only attach listeners once per app session — register() may be
      // called multiple times (sign-in, app foreground) but the listeners
      // should be set up once.
      if (!registered) {
        await PushNotifications.addListener('registration', (token: Token) => {
          void postTokenToApi(token.value, platform, tokenType);
          void sendDeviceTokenToIntercom(token.value);
        });
        await PushNotifications.addListener(
          'registrationError',
          (error: RegistrationError) => {
            logError('push.registrationError', error);
          }
        );
        if (handlers?.onReceived) {
          await PushNotifications.addListener(
            'pushNotificationReceived',
            handlers.onReceived
          );
        }
        if (handlers?.onActionPerformed) {
          await PushNotifications.addListener(
            'pushNotificationActionPerformed',
            handlers.onActionPerformed
          );
        }
        registered = true;
      }

      await PushNotifications.register();
      return null;
    } catch (error) {
      logError('push.register', error);
      initPromise = null;
      return null;
    }
  })();

  return initPromise;
}

/**
 * Tell the API to forget this device. Best-effort — failures during sign-out
 * shouldn't block the user. We can't recover the token from a non-listener
 * context with this plugin (no `getToken()` API), so unregister-by-token
 * relies on the cached value from the most recent registration callback.
 */
export async function unregisterPushNotifications(): Promise<void> {
  if (!Capacitor.isNativePlatform()) return;

  try {
    if (cachedToken) {
      await apiClient.delete('notifications/push-token', {
        token: cachedToken,
      });
    }
    await PushNotifications.unregister();
  } catch {
    // Non-critical during sign-out
  } finally {
    cachedToken = null;
    initPromise = null;
  }
}

let cachedToken: string | null = null;

async function postTokenToApi(
  token: string,
  platform: Platform,
  tokenType: TokenType
): Promise<void> {
  cachedToken = token;
  if (!getApiClientConfig()) {
    // Registration can fire before TelemetryBootstrap configures the client
    // (e.g. cold launch with a stored session). Retry briefly.
    await waitForApiClient(5_000);
  }
  if (!getApiClientConfig()) {
    logError(
      'push.postTokenToApi',
      new Error('API client not configured. Call configureApiClient() first.')
    );
    return;
  }
  try {
    await apiClient.post('notifications/push-token', {
      token,
      platform,
      tokenType,
    });
  } catch (error) {
    logError('push.postTokenToApi', error);
  }
}

function waitForApiClient(timeoutMs: number): Promise<void> {
  const started = Date.now();
  return new Promise((resolve) => {
    const tick = () => {
      if (getApiClientConfig() || Date.now() - started >= timeoutMs) {
        resolve();
        return;
      }
      setTimeout(tick, 100);
    };
    tick();
  });
}

async function sendDeviceTokenToIntercom(token: string): Promise<void> {
  // Intercom needs the raw APNs/FCM device token to deliver its own pushes.
  // The @capacitor-community/intercom plugin only implements
  // `sendPushTokenToIntercom` on Android; on iOS it throws "not implemented".
  // That's fine: on iOS the plugin forwards the APNs token natively — it
  // observes the `capacitorDidRegisterForRemoteNotifications` notification
  // posted by our AppDelegate and calls `Intercom.setDeviceToken` itself, so
  // there is nothing to do from JS.
  if (Capacitor.getPlatform() !== 'android') {
    return;
  }
  // Safe to call before stream 3M wires `loadWithKeys` — the plugin queues
  // the value and the SDK applies it once initialized. Failure is non-fatal.
  try {
    await Intercom.sendPushTokenToIntercom({ value: token });
  } catch (error) {
    logError('push.sendDeviceTokenToIntercom', error);
  }
}
