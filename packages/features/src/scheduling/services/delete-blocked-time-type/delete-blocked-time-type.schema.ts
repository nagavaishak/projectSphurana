import { z } from 'zod';

export const deleteBlockedTimeTypeSchema = z.object({
  id: z.string().min(1),
  organizationId: z.string().min(1),
});

export type DeleteBlockedTimeTypeInput = z.infer<
  typeof deleteBlockedTimeTypeSchema
>;
