import { z } from 'zod';

export const getBatchFaceGroupsSchema = z.object({
  batchId: z.string().min(1),
  organizationId: z.string().min(1),
});

export type GetBatchFaceGroupsInput = z.infer<typeof getBatchFaceGroupsSchema>;
