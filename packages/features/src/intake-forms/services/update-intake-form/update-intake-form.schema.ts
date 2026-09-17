import { z } from 'zod';
import { intakeFormFieldsSchema } from '../../shared/field-schema.js';

export const updateIntakeFormSchema = z.object({
  organizationId: z.string().min(1),
  id: z.string().min(1),
  name: z.string().min(1).optional(),
  description: z.string().nullable().optional(),
  fields: intakeFormFieldsSchema.optional(),
  isActive: z.boolean().optional(),
});
export type UpdateIntakeFormInput = z.infer<typeof updateIntakeFormSchema>;
