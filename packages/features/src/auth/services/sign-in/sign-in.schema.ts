import { z } from 'zod';

/**
 * Schema for user sign-in
 */
export const signInSchema = z.object({
  email: z.string().email('Invalid email format'),
  password: z.string().min(1, 'Password is required'),
});

/**
 * Input type inferred from schema
 */
export type SignInInput = z.infer<typeof signInSchema>;
