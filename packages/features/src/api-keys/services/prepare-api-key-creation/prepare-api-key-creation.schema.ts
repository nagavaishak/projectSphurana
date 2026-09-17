import { z } from 'zod';

export const prepareApiKeyCreationSchema = z.object({
  organizationId: z.string().min(1, 'Organization ID is required'),
});

export type PrepareApiKeyCreationInput = z.infer<
  typeof prepareApiKeyCreationSchema
>;
