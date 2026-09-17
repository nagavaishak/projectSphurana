import { z } from 'zod';

export const getProductSchema = z.object({
  id: z.string().min(1),
  organizationId: z.string().min(1),
});

export type GetProductInput = z.infer<typeof getProductSchema>;
