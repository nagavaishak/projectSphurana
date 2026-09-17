import { z } from 'zod';

/** Only allow relative paths — prevents open redirect to external sites */
const relativePathOnly = z
  .string()
  .refine((val) => val.startsWith('/') && !val.startsWith('//'), {
    message: 'Must be a relative path (e.g. /onboarding)',
  });

export const googleSignUpSchema = z.object({
  callbackURL: relativePathOnly.optional().default('/onboarding'),
  errorCallbackURL: relativePathOnly.optional(),
});

export type GoogleSignUpInput = z.infer<typeof googleSignUpSchema>;
