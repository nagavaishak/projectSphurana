import { apiEnv } from '@borradh-workspace/env/api';
import { createLogger, logError } from '@borradh-workspace/observability';

import type { DispatchInput, DispatchResult } from './types.js';

const logger = createLogger('notifications.apns');

// Provider is lazy-loaded — we don't want to import `@parse/node-apn` or open
// an HTTP/2 connection on module load. `null` = not initialized yet,
// `false` = initialization attempted and failed (credentials missing).
//
// `unknown` is intentional here: `@parse/node-apn` doesn't ship strict ESM
// types we can statically import without forcing the dep on consumers that
// never send iOS push.
let apnsProvider: unknown | null | false = null;

async function getProvider(): Promise<unknown | null> {
  if (apnsProvider === false) return null;
  if (apnsProvider) return apnsProvider;

  const { APNS_KEY_ID, APNS_TEAM_ID, APNS_KEY_P8_BASE64, APNS_PRODUCTION } =
    apiEnv;

  if (!APNS_KEY_ID || !APNS_TEAM_ID || !APNS_KEY_P8_BASE64) {
    logger.warn(
      'APNS_KEY_ID / APNS_TEAM_ID / APNS_KEY_P8_BASE64 not all set — iOS push delivery disabled'
    );
    apnsProvider = false;
    return null;
  }

  try {
    const apn = await import('@parse/node-apn');
    const Provider = (
      apn as unknown as { Provider: new (opts: unknown) => unknown }
    ).Provider;
    apnsProvider = new Provider({
      token: {
        key: Buffer.from(APNS_KEY_P8_BASE64, 'base64').toString('utf8'),
        keyId: APNS_KEY_ID,
        teamId: APNS_TEAM_ID,
      },
      production: APNS_PRODUCTION,
    });
    return apnsProvider;
  } catch (error) {
    logError('notifications.apns.init', error, { feature: 'notifications' });
    apnsProvider = false;
    return null;
  }
}

export async function dispatchApns(
  input: DispatchInput
): Promise<DispatchResult> {
  const { tokens, title, body, data, userId } = input;
  if (tokens.length === 0) {
    return { sent: 0, failed: 0, invalidTokens: [] };
  }

  const provider = await getProvider();
  if (!provider) {
    return {
      sent: 0,
      failed: tokens.length,
      invalidTokens: [],
      configError:
        'APNs not configured (APNS_KEY_ID / APNS_TEAM_ID / APNS_KEY_P8_BASE64)',
    };
  }

  const bundleId = apiEnv.APNS_BUNDLE_ID ?? 'com.borradh.mobile';

  let sent = 0;
  let failed = 0;
  const invalidTokens: string[] = [];

  try {
    const apn = await import('@parse/node-apn');
    const Notification = (
      apn as unknown as { Notification: new () => ApnsNotification }
    ).Notification;
    const note = new Notification();
    note.topic = bundleId;
    note.alert = { title, body };
    note.sound = 'default';
    if (data) note.payload = data;

    // node-apn accepts an array of device tokens for a single Notification.
    type ApnsSendResult = {
      sent: Array<{ device: string }>;
      failed: Array<{
        device: string;
        status?: string;
        response?: { reason?: string };
      }>;
    };
    const result = (await (
      provider as { send: (n: unknown, t: string[]) => Promise<ApnsSendResult> }
    ).send(note, tokens)) as ApnsSendResult;

    sent = result.sent.length;
    failed = result.failed.length;

    for (const fail of result.failed) {
      // APNs returns 410 Gone (and reason 'Unregistered' / 'BadDeviceToken')
      // for tokens that should be cleaned up.
      const reason = fail.response?.reason;
      if (
        fail.status === '410' ||
        reason === 'Unregistered' ||
        reason === 'BadDeviceToken' ||
        reason === 'DeviceTokenNotForTopic'
      ) {
        invalidTokens.push(fail.device);
      }
    }
  } catch (error) {
    logError('notifications.apns.send', error, {
      feature: 'notifications',
      extra: { userId, tokenCount: tokens.length },
    });
    failed += tokens.length - sent;
  }

  return { sent, failed, invalidTokens };
}

// Minimal structural type for the parts of node-apn's Notification we set.
// Avoids forcing the @parse/node-apn types on consumers that never send.
interface ApnsNotification {
  topic: string;
  alert: { title: string; body: string } | string;
  sound: string;
  payload?: Record<string, unknown>;
}
