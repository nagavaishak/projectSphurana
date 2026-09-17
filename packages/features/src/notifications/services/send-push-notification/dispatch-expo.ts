import { logError } from '@borradh-workspace/observability';
import { Expo } from 'expo-server-sdk';

import type { DispatchInput, DispatchResult } from './types.js';

let expoClient: Expo | null = null;
function getExpoClient(): Expo {
  if (!expoClient) {
    expoClient = new Expo();
  }
  return expoClient;
}

export async function dispatchExpo(
  input: DispatchInput
): Promise<DispatchResult> {
  const { tokens, title, body, data, userId } = input;

  const valid = tokens.filter((t) => Expo.isExpoPushToken(t));
  if (valid.length === 0) {
    return { sent: 0, failed: 0, invalidTokens: [] };
  }

  const expo = getExpoClient();
  const messages = valid.map((to) => ({
    to,
    sound: 'default' as const,
    title,
    body,
    data: data as Record<string, unknown> | undefined,
  }));

  const chunks = expo.chunkPushNotifications(messages);
  let sent = 0;
  let failed = 0;
  const invalidTokens: string[] = [];

  for (const chunk of chunks) {
    try {
      const receipts = await expo.sendPushNotificationsAsync(chunk);
      for (let i = 0; i < receipts.length; i++) {
        const receipt = receipts[i];
        if (receipt.status === 'ok') {
          sent++;
        } else {
          failed++;
          if (
            receipt.details?.error === 'DeviceNotRegistered' &&
            chunk[i]?.to
          ) {
            const to = chunk[i].to;
            const tokenStr =
              typeof to === 'string' ? to : Array.isArray(to) ? to[0] : null;
            if (tokenStr) invalidTokens.push(tokenStr);
          }
        }
      }
    } catch (error) {
      logError('notifications.sendPushNotification.expo', error, {
        feature: 'notifications',
        extra: { userId, chunkSize: chunk.length },
      });
      failed += chunk.length;
    }
  }

  return { sent, failed, invalidTokens };
}
