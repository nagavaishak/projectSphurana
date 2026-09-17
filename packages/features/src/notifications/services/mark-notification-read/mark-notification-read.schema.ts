import { z } from 'zod';

/**
 * Schema for marking a single notification as read
 */
export const markNotificationReadSchema = z.object({
  id: z.string().min(1, 'Notification ID is required'),
  userId: z.string().min(1, 'User ID is required'),
});

/**
 * Input type inferred from schema
 */
export type MarkNotificationReadInput = z.infer<
  typeof markNotificationReadSchema
>;
