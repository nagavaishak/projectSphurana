import { z } from 'zod';

/**
 * Schema for deleting a user
 */
export const deleteUserSchema = z.object({
  id: z.string().min(1, 'User ID is required'),
});

/**
 * Input type inferred from schema
 */
export type DeleteUserInput = z.infer<typeof deleteUserSchema>;
