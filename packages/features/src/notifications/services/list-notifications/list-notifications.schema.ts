import { z } from 'zod';

/**
 * Schema for listing a user's notifications
 */
export const listNotificationsSchema = z.object({
  userId: z.string().min(1, 'User ID is required'),
  limit: z.coerce.number().int().positive().max(50).default(20),
  offset: z.coerce.number().int().nonnegative().default(0),
});

/**
 * Input type inferred from schema
 */
export type ListNotificationsInput = z.infer<typeof listNotificationsSchema>;
