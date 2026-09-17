import { z } from 'zod';

export const deleteSequenceSchema = z.object({
  id: z.string().min(1, 'Sequence ID is required'),
  organizationId: z.string().min(1, 'Organization ID is required'),
  actorId: z.string().optional(),
});

export type DeleteSequenceInput = z.infer<typeof deleteSequenceSchema>;
