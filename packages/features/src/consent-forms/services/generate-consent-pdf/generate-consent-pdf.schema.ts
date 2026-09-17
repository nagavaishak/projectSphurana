import { z } from 'zod';

export const generateConsentPdfSchema = z.object({
  submissionId: z.string().min(1, 'Submission ID is required'),
  organizationId: z.string().min(1, 'Organization ID is required'),
});

export type GenerateConsentPdfInput = z.infer<typeof generateConsentPdfSchema>;
