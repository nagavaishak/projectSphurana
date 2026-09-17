import { z } from 'zod';
import { consentFormFieldSchema } from '../shared/field.schema.js';

export const createConsentFormTemplateSchema = z.object({
  organizationId: z.string().min(1, 'Organization ID is required'),
  title: z.string().min(1, 'Title is required').max(200),
  /** Form body (markdown-ish rich text; {{patientName}} placeholder). */
  // Bounded. The only ceiling was the global 1MB body-parser limit, which
  // still permits a consent form that composes into a ~230-page PDF — and
  // that compose runs SYNCHRONOUSLY on the download path, for every reader.
  // 50k characters is a very long consent form and a cheap document.
  body: z
    .string()
    .min(1, 'Body is required')
    .max(50_000, 'This form is too long — please shorten it'),
  fields: z.array(consentFormFieldSchema).max(50).default([]),
  requiresSignature: z.boolean().default(true),
});

export type CreateConsentFormTemplateInput = z.infer<
  typeof createConsentFormTemplateSchema
>;
