import { z } from 'zod';

export const createManualPairSchema = z.object({
  organizationId: z.string().min(1, 'Organization ID is required'),
  batchId: z.string().min(1, 'Batch ID is required'),
  beforeAssetId: z.string().min(1, 'Before asset ID is required'),
  afterAssetId: z.string().min(1, 'After asset ID is required'),
  clientName: z.string().optional(),
  serviceId: z.string().min(1).optional(),
});

export type CreateManualPairInput = z.infer<typeof createManualPairSchema>;
