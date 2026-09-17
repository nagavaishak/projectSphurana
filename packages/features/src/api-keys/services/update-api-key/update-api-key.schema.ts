import { z } from 'zod';

export const updateApiKeySchema = z.object({
  keyId: z.string().min(1, 'Key ID is required'),
  organizationId: z.string().min(1, 'Organization ID is required'),
  name: z.string().min(1).max(100).optional(),
  enabled: z.boolean().optional(),
});

export type UpdateApiKeyInput = z.infer<typeof updateApiKeySchema>;
