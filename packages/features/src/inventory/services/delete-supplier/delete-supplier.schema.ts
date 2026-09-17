import { z } from 'zod';

export const deleteSupplierSchema = z.object({
  id: z.string().min(1),
  organizationId: z.string().min(1),
});

export type DeleteSupplierInput = z.infer<typeof deleteSupplierSchema>;
