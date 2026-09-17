import { z } from 'zod';

/**
 * Schema for checking email
 */
export const checkEmailSchema = z.object({
  email: z.string().email('Invalid email format'),
});

/**
 * Input type inferred from schema
 */
export type CheckEmailInput = z.infer<typeof checkEmailSchema>;
