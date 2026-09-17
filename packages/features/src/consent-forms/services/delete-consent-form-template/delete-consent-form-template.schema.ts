import { z } from 'zod';

export const deleteConsentFormTemplateSchema = z.object({
  id: z.string().min(1, 'Template ID is required'),
  organizationId: z.string().min(1, 'Organization ID is required'),
});

export type DeleteConsentFormTemplateInput = z.infer<
  typeof deleteConsentFormTemplateSchema
>;
