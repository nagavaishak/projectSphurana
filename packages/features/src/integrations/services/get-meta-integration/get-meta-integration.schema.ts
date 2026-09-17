import { z } from 'zod';

export const getMetaIntegrationSchema = z.object({
  organizationId: z.string().min(1, 'Organization ID is required'),
});

export type GetMetaIntegrationInput = z.infer<typeof getMetaIntegrationSchema>;
