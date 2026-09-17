import { z } from 'zod';

export const deactivateSequenceSchema = z.object({
  id: z.string().min(1, 'Sequence ID is required'),
  organizationId: z.string().min(1, 'Organization ID is required'),
});

export type DeactivateSequenceInput = z.infer<typeof deactivateSequenceSchema>;
