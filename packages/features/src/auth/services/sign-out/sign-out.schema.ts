import { z } from 'zod';

/**
 * Schema for sign-out - requires session token
 */
export const signOutSchema = z.object({
  sessionToken: z.string().min(1, 'Session token is required'),
});

/**
 * Input type inferred from schema
 */
export type SignOutInput = z.infer<typeof signOutSchema>;
