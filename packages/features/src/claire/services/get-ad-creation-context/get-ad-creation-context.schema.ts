import { z } from 'zod';

export const getAdCreationContextSchema = z.object({
  organizationId: z.string().min(1, 'Organization ID is required'),
});

export type GetAdCreationContextInput = z.infer<
  typeof getAdCreationContextSchema
>;
