import { consentFormFieldTypeValues } from '@borradh-workspace/labels';
import { z } from 'zod';

/**
 * Input for "Write with AI" — a short natural-language description of the
 * consent form the clinic wants (e.g. "Botox consent for a medspa, ask about
 * allergies and pregnancy"). The service turns it into a full template draft.
 */
export const generateConsentFormTemplateSchema = z.object({
  organizationId: z.string().min(1, 'Organization ID is required'),
  prompt: z
    .string()
    .min(1, 'Describe the form you want')
    .max(1000, 'Description is too long'),
});

export type GenerateConsentFormTemplateInput = z.infer<
  typeof generateConsentFormTemplateSchema
>;

/**
 * Structured template draft the LLM must return. Mirrors the create-template
 * input shape (title / body / fields / requiresSignature) so the dialog can
 * drop it straight into the form. `body` supports the `{{patientName}}`
 * placeholder the renderer interpolates at sign time.
 */
export const generatedConsentFormTemplateSchema = z.object({
  title: z.string().min(1).max(200),
  body: z.string().min(1).max(6000),
  fields: z
    .array(
      z.object({
        type: z.enum(consentFormFieldTypeValues),
        label: z.string().min(1).max(200),
      })
    )
    .max(50)
    .default([]),
  requiresSignature: z.boolean().default(true),
});

export type GeneratedConsentFormTemplate = z.infer<
  typeof generatedConsentFormTemplateSchema
>;
