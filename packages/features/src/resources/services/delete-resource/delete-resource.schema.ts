import { z } from 'zod';

export const deleteResourceSchema = z.object({
  id: z.string().min(1),
  organizationId: z.string().min(1),
});

export type DeleteResourceInput = z.infer<typeof deleteResourceSchema>;
