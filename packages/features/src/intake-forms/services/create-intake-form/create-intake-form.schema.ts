import { z } from 'zod';
import { intakeFormFieldsSchema } from '../../shared/field-schema.js';

export const createIntakeFormSchema = z.object({
  organizationId: z.string().min(1),
  name: z.string().min(1, 'Name required'),
  description: z.string().optional(),
  fields: intakeFormFieldsSchema.default([]),
  createdById: z.string().optional(),
});

export type CreateIntakeFormInput = z.infer<typeof createIntakeFormSchema>;
