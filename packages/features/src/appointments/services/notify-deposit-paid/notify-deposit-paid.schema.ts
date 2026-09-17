import { z } from 'zod';

export const notifyDepositPaidSchema = z.object({
  depositId: z.string().min(1, 'Deposit ID is required'),
});

export type NotifyDepositPaidInput = z.infer<typeof notifyDepositPaidSchema>;
