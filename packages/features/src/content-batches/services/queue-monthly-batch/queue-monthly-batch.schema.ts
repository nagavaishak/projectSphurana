import { z } from 'zod';

export const CONTENT_BATCH_GENERATE_QUEUE = 'content-batch-generate';

/**
 * Serializable hand-off between the API preflight and the worker. The API has
 * already resolved the batch row and effective modality counts before this is
 * enqueued; the worker only performs the slow plan/seed phase.
 */
export const contentBatchGenerationJobSchema = z.object({
  batchId: z.string().min(1),
  organizationId: z.string().min(1),
  periodMonth: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/),
  createdById: z.string().min(1),
  graphicCount: z.number().int().min(0).max(10),
  videoCount: z.number().int().min(0).max(10),
  serviceIds: z.array(z.string().min(1)).optional(),
  allowStockFootage: z.boolean().default(false),
  videoPositionOffset: z.number().int().min(0),
  graphicPositionOffset: z.number().int().min(0),
  markFailedOnError: z.boolean(),
});

export type ContentBatchGenerationJobPayload = z.infer<
  typeof contentBatchGenerationJobSchema
>;
