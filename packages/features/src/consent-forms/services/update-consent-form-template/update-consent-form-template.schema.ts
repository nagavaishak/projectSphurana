import { z } from 'zod';
import { consentFormFieldSchema } from '../shared/field.schema.js';

export const updateConsentFormTemplateSchema = z.object({
  id: z.string().min(1, 'Template ID is required'),
  organizationId: z.string().min(1, 'Organization ID is required'),
  title: z.string().min(1).max(200).optional(),
  // See create-consent-form-template.schema.ts for why this is bounded.
  body: z.string().min(1).max(50_000).optional(),
  fields: z.array(consentFormFieldSchema).max(50).optional(),
  requiresSignature: z.boolean().optional(),
  isActive: z.boolean().optional(),
});

export type UpdateConsentFormTemplateInput = z.infer<
  typeof updateConsentFormTemplateSchema
>;
