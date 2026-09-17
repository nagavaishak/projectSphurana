import { z } from 'zod';
export const getServiceIntakeFormsSchema = z.object({
  organizationId: z.string().min(1),
  serviceId: z.string().min(1),
});
export type GetServiceIntakeFormsInput = z.infer<
  typeof getServiceIntakeFormsSchema
>;

export interface ServiceIntakeFormLink {
  intakeFormId: string;
  intakeFormName: string;
  blocksBooking: boolean;
}
