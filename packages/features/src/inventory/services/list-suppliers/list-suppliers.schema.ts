import { z } from 'zod';

export const listSuppliersSchema = z.object({
  organizationId: z.string().min(1),
});

export type ListSuppliersInput = z.infer<typeof listSuppliersSchema>;
