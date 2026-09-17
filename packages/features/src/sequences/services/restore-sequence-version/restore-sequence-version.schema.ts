import { z } from 'zod';

export const restoreSequenceVersionSchema = z.object({
  sequenceId: z.string().min(1, 'Sequence ID is required'),
  versionId: z.string().min(1, 'Version ID is required'),
  organizationId: z.string().min(1, 'Organization ID is required'),
  userId: z.string().min(1, 'User ID is required'),
});

export type RestoreSequenceVersionInput = z.infer<
  typeof restoreSequenceVersionSchema
>;
