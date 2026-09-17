import { z } from 'zod';
export const getIntakeFormSchema = z.object({
  organizationId: z.string().min(1),
  id: z.string().min(1),
});
export type GetIntakeFormInput = z.infer<typeof getIntakeFormSchema>;
