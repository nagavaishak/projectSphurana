import { z } from 'zod';

/**
 * Schema for verifying email with a token
 */
export const verifyEmailSchema = z.object({
  token: z.string().min(1, 'Token is required'),
});

/**
 * Input type inferred from schema
 */
export type VerifyEmailInput = z.infer<typeof verifyEmailSchema>;
