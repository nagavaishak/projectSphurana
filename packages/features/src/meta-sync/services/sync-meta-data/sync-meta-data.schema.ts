import { z } from 'zod';

export const syncMetaDataSchema = z.object({
  organizationId: z.string().min(1, 'Organization ID is required'),
  userId: z.string().min(1, 'User ID is required'),
  force: z.boolean().optional().default(false),
});

export type SyncMetaDataInput = z.infer<typeof syncMetaDataSchema>;
