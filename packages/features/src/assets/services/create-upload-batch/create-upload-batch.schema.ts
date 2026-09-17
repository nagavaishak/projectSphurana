import { z } from 'zod';

/**
 * Create Upload Batch Input Schema
 * Creates a batch record for tracking a group of asset uploads
 */
export const createUploadBatchSchema = z.object({
  totalAssets: z.number().int().min(1),
  organizationId: z.string().min(1),
  createdById: z.string().min(1),
});

export type CreateUploadBatchInput = z.infer<typeof createUploadBatchSchema>;
