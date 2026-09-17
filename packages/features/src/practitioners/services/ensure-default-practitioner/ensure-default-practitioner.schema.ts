import { z } from 'zod';

export const ensureDefaultPractitionerSchema = z.object({
  organizationId: z.string().min(1, 'Organization ID is required'),
});

export type EnsureDefaultPractitionerInput = z.infer<
  typeof ensureDefaultPractitionerSchema
>;
