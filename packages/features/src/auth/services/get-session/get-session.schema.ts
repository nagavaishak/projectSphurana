import { z } from 'zod';

/**
 * Schema for get-session - requires session token
 */
export const getSessionSchema = z.object({
  sessionToken: z.string().min(1, 'Session token is required'),
});

/**
 * Input type inferred from schema
 */
export type GetSessionInput = z.infer<typeof getSessionSchema>;
