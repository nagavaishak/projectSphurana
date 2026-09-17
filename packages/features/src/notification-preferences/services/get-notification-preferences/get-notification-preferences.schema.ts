import { z } from 'zod';

export const getNotificationPreferencesSchema = z.object({
  userId: z.string().min(1, 'User ID is required'),
});

export type GetNotificationPreferencesInput = z.infer<
  typeof getNotificationPreferencesSchema
>;
