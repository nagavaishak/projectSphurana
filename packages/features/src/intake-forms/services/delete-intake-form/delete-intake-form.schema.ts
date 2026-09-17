import { z } from 'zod';
export const deleteIntakeFormSchema = z.object({
  organizationId: z.string().min(1),
  id: z.string().min(1),
});
export type DeleteIntakeFormInput = z.infer<typeof deleteIntakeFormSchema>;
