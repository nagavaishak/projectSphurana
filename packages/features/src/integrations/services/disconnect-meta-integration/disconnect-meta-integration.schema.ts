import { z } from 'zod';

export const disconnectMetaIntegrationSchema = z.object({
  organizationId: z.string().min(1, 'Organization ID is required'),
});

export type DisconnectMetaIntegrationInput = z.infer<
  typeof disconnectMetaIntegrationSchema
>;
