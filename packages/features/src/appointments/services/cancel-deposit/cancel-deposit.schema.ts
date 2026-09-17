import { z } from 'zod';

export const cancelDepositSchema = z.object({
  depositId: z.string().min(1),
  organizationId: z.string().min(1),
});

export type CancelDepositInput = z.infer<typeof cancelDepositSchema>;
