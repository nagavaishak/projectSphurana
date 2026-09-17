import { z } from 'zod';

export const listMetaAdsPagesSchema = z.object({
  organizationId: z.string().min(1, 'Organization ID is required'),
});

export type ListMetaAdsPagesInput = z.infer<typeof listMetaAdsPagesSchema>;
