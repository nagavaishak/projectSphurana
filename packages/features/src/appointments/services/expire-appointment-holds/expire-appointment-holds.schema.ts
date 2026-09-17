import { z } from 'zod';

export const expireAppointmentHoldsSchema = z.object({
  /** Cap on holds released per tick, so one run cannot monopolise the worker. */
  batchSize: z.number().int().min(1).max(500).optional().default(100),
});

export type ExpireAppointmentHoldsInput = z.input<
  typeof expireAppointmentHoldsSchema
>;
