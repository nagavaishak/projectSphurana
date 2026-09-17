import { z } from 'zod';

export const incrementUsageSchema = z.object({
  organizationId: z.string().min(1),
});

export type IncrementUsageInput = z.infer<typeof incrementUsageSchema>;
