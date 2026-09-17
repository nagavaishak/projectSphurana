import { z } from 'zod';

/**
 * Schema for getting a user by ID
 */
export const getUserSchema = z.object({
  id: z.string().min(1, 'User ID is required'),
});

/**
 * Input type inferred from schema
 */
export type GetUserInput = z.infer<typeof getUserSchema>;
