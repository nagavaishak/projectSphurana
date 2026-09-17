import { z } from 'zod';

export const deleteTimeOffSchema = z.object({
  id: z.string().min(1),
  organizationId: z.string().min(1),
});

export type DeleteTimeOffInput = z.infer<typeof deleteTimeOffSchema>;
