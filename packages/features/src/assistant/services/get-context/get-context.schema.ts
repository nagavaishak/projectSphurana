import { z } from 'zod';

export const getContextSchema = z.object({
  organizationId: z.string().min(1),
});

export type GetContextInput = z.infer<typeof getContextSchema>;
