import { z } from 'zod';

export const expireAppointmentDepositSchema = z.object({
  depositId: z.string().min(1),
});

export type ExpireAppointmentDepositInput = z.input<
  typeof expireAppointmentDepositSchema
>;
