import { z } from 'zod';

/**
 * Schema for resending verification email
 */
export const resendVerificationSchema = z.object({
  email: z.string().email('Invalid email address'),
  callbackURL: z
    .string()
    .refine((val) => val.startsWith('/') && !val.startsWith('//'), {
      message: 'Must be a relative path',
    })
    .optional()
    .default('/onboarding'),
});

/**
 * Input type inferred from schema
 */
export type ResendVerificationInput = z.infer<typeof resendVerificationSchema>;
