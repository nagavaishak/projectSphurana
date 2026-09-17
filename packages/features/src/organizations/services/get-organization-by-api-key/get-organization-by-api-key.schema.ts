import { z } from 'zod';

export const getOrganizationByApiKeySchema = z.object({
  apiKey: z.string().min(1, 'API key is required'),
});

export type GetOrganizationByApiKeyInput = z.infer<
  typeof getOrganizationByApiKeySchema
>;
