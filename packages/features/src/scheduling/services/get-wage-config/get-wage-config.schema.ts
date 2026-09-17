import { z } from 'zod';

export const getWageConfigSchema = z.object({
  organizationId: z.string().min(1),
  practitionerId: z.string().min(1),
});

export type GetWageConfigInput = z.infer<typeof getWageConfigSchema>;
