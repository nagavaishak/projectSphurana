import { z } from 'zod';

/**
 * Passwordless sign-in, step 2: exchange the emailed 6-digit code for a
 * session. `code` is deliberately just min(1) — a malformed code fails with
 * the SAME generic message as a wrong one (Better Auth returns a generic
 * INVALID_OTP), instead of a distinguishable validation error.
 */
export const verifyOtpSchema = z.object({
  organizationSlug: z.string().min(1, 'Organization slug is required'),
  email: z
    .string()
    .email('Invalid email address')
    .transform((v) => v.trim().toLowerCase()),
  code: z.string().min(1, 'Code is required'),
});

export type VerifyOtpInput = z.infer<typeof verifyOtpSchema>;
