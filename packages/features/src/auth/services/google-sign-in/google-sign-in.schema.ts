import { z } from 'zod';

/** Only allow relative paths — prevents open redirect to external sites */
const relativePathOnly = z
  .string()
  .refine((val) => val.startsWith('/') && !val.startsWith('//'), {
    message: 'Must be a relative path (e.g. /dashboard)',
  });

export const googleSignInSchema = z.object({
  callbackURL: relativePathOnly.optional().default('/dashboard'),
  errorCallbackURL: relativePathOnly.optional(),
  newUserCallbackURL: relativePathOnly.optional(),
});

export type GoogleSignInInput = z.infer<typeof googleSignInSchema>;
