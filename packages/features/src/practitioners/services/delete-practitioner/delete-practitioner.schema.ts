import { z } from 'zod';

export const deletePractitionerSchema = z.object({
  id: z.string().min(1, 'Practitioner ID is required'),
  organizationId: z.string().min(1, 'Organization ID is required'),
  actorId: z.string().optional(),
});

export type DeletePractitionerInput = z.infer<typeof deletePractitionerSchema>;
