import { z } from 'zod';

export const listApiKeysSchema = z.object({
  organizationId: z.string().min(1, 'Organization ID is required'),
});

export type ListApiKeysInput = z.infer<typeof listApiKeysSchema>;
