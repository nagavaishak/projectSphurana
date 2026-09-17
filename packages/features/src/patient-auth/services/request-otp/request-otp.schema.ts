import { z } from 'zod';

/**
 * Passwordless sign-in, step 1: ask for a 6-digit code by email. Identity
 * only — proving you own the inbox IS the credential, so nothing else is
 * collected here.
 */
export const requestOtpSchema = z.object({
  organizationSlug: z.string().min(1, 'Organization slug is required'),
  email: z
    .string()
    .email('Invalid email address')
    .transform((v) => v.trim().toLowerCase()),
});

export type RequestOtpInput = z.infer<typeof requestOtpSchema>;
