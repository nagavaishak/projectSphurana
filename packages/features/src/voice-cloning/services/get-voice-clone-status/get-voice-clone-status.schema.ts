import { z } from 'zod';

export const getVoiceCloneStatusSchema = z.object({
  organizationId: z.string().min(1),
});

export type GetVoiceCloneStatusInput = z.infer<
  typeof getVoiceCloneStatusSchema
>;
