import { z } from 'zod';

/**
 * Schema for marking all of a user's notifications as read
 */
export const markAllNotificationsReadSchema = z.object({
  userId: z.string().min(1, 'User ID is required'),
});

/**
 * Input type inferred from schema
 */
export type MarkAllNotificationsReadInput = z.infer<
  typeof markAllNotificationsReadSchema
>;
