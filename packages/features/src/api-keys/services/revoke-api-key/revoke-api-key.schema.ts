import { z } from 'zod';

export const revokeApiKeySchema = z.object({
  keyId: z.string().min(1, 'Key ID is required'),
  organizationId: z.string().min(1, 'Organization ID is required'),
});

export type RevokeApiKeyInput = z.infer<typeof revokeApiKeySchema>;
