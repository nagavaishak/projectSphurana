import { z } from 'zod';

export const getUsageSchema = z.object({
  organizationId: z.string().min(1),
});

export type GetUsageInput = z.infer<typeof getUsageSchema>;
