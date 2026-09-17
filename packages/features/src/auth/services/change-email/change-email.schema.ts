import { z } from 'zod';

/**
 * Schema for changing user email
 */
export const changeEmailSchema = z.object({
  newEmail: z.string().email('Invalid email address'),
  callbackURL: z
    .string()
    .refine((val) => val.startsWith('/') && !val.startsWith('//'), {
      message: 'Must be a relative path (e.g. /dashboard)',
    })
    .optional(),
});

export type ChangeEmailInput = z.infer<typeof changeEmailSchema>;
