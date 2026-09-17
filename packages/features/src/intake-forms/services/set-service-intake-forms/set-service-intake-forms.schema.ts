import { z } from 'zod';
export const setServiceIntakeFormsSchema = z.object({
  organizationId: z.string().min(1),
  serviceId: z.string().min(1),
  forms: z
    .array(
      z.object({
        intakeFormId: z.string().min(1),
        blocksBooking: z.boolean().default(false),
      })
    )
    .default([]),
});
export type SetServiceIntakeFormsInput = z.infer<
  typeof setServiceIntakeFormsSchema
>;
