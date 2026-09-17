import { z } from 'zod';

/**
 * Schema for Apple native sign-in (iOS identity token)
 */
export const appleNativeSignInSchema = z.object({
  /** Apple identity token (JWT signed by Apple, obtained via expo-apple-authentication) */
  identityToken: z.string().min(1, 'Identity token is required'),
  /** User's full name (only provided on first sign-in with Apple) */
  fullName: z
    .object({
      givenName: z.string().nullish(),
      familyName: z.string().nullish(),
    })
    .optional(),
});

/**
 * Input type inferred from schema
 */
export type AppleNativeSignInInput = z.infer<typeof appleNativeSignInSchema>;
