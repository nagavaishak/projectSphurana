import { z } from 'zod';

export const updateSupplierSchema = z.object({
  id: z.string().min(1),
  organizationId: z.string().min(1),
  name: z.string().min(1, 'Name is required'),
  description: z.string().nullable().optional(),
});

export type UpdateSupplierInput = z.infer<typeof updateSupplierSchema>;
