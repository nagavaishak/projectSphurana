import { z } from 'zod';

/**
 * Schema for getting a user's unread notification count
 */
export const getUnreadNotificationCountSchema = z.object({
  userId: z.string().min(1, 'User ID is required'),
});

/**
 * Input type inferred from schema
 */
export type GetUnreadNotificationCountInput = z.infer<
  typeof getUnreadNotificationCountSchema
>;
