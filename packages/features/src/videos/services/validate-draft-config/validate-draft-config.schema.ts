import { z } from 'zod';

export const validateDraftConfigSchema = z.object({
  id: z.string().min(1, 'Video ID is required'),
});

export type ValidateDraftConfigInput = z.infer<
  typeof validateDraftConfigSchema
>;
