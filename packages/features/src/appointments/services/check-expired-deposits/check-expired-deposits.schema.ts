import { z } from 'zod';

export const checkExpiredDepositsSchema = z.object({
  batchSize: z.number().int().min(1).max(100).default(50),
});

export type CheckExpiredDepositsInput = z.input<
  typeof checkExpiredDepositsSchema
>;
