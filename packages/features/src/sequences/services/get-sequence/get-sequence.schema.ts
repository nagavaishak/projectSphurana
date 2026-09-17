import { z } from 'zod';

export const getSequenceSchema = z.object({
  id: z.string().min(1, 'Sequence ID is required'),
  organizationId: z.string().min(1, 'Organization ID is required'),
});

export type GetSequenceInput = z.infer<typeof getSequenceSchema>;
