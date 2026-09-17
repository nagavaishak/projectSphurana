import { z } from 'zod';

export const registerPushTokenSchema = z.object({
  userId: z.string().min(1),
  token: z.string().min(1, 'Push token is required'),
  platform: z.enum(['ios', 'android']),
  // 'expo' = legacy proxy token from apps/mobile (default for backward compat
  // until apps/mobile retires in Phase 5). 'apns'/'fcm' = raw native tokens
  // from apps/app via @capacitor/push-notifications.
  tokenType: z.enum(['expo', 'apns', 'fcm']).default('expo'),
});

export type RegisterPushTokenInput = z.infer<typeof registerPushTokenSchema>;
