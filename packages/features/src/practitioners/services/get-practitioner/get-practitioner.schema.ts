import { z } from 'zod';

export const getPractitionerSchema = z.object({
  id: z.string().min(1, 'Practitioner ID is required'),
  organizationId: z.string().min(1, 'Organization ID is required'),
});

export type GetPractitionerInput = z.infer<typeof getPractitionerSchema>;
