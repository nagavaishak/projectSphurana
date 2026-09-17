import { z } from 'zod';

export const verifyApiKeySchema = z.object({
  /** The API key to verify */
  key: z.string().min(1, 'API key is required'),
});

export type VerifyApiKeyInput = z.infer<typeof verifyApiKeySchema>;
