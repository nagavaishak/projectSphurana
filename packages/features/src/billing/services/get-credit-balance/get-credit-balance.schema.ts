import { z } from 'zod';

export const getCreditBalanceSchema = z.object({
  organizationId: z.string().min(1, 'Organization ID is required'),
});

export type GetCreditBalanceInput = z.infer<typeof getCreditBalanceSchema>;
