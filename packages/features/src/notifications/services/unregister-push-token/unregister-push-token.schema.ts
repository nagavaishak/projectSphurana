import { z } from 'zod';

export const unregisterPushTokenSchema = z.object({
  token: z.string().min(1, 'Push token is required'),
});

export type UnregisterPushTokenInput = z.infer<
  typeof unregisterPushTokenSchema
>;
