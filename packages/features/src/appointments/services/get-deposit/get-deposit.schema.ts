import { z } from 'zod';

export const getDepositSchema = z
  .object({
    depositId: z.string().min(1).optional(),
    appointmentId: z.string().min(1).optional(),
    organizationId: z.string().min(1),
  })
  .refine((data) => data.depositId || data.appointmentId, {
    message: 'Either depositId or appointmentId is required',
  });

export type GetDepositInput = z.infer<typeof getDepositSchema>;
