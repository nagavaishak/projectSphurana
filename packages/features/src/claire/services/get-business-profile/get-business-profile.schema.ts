import { z } from 'zod';

export const getBusinessProfileSchema = z.object({
  organizationId: z.string().min(1),
});

export type GetBusinessProfileInput = z.infer<typeof getBusinessProfileSchema>;
