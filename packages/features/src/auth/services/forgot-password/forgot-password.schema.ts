import { z } from 'zod';

export const forgotPasswordSchema = z.object({
  email: z.string().email('Invalid email format'),
  redirectTo: z.string().url().optional(),
});

export type ForgotPasswordInput = z.infer<typeof forgotPasswordSchema>;
