import { z } from 'zod';

export const setDefaultLeadFormSchema = z.object({
  organizationId: z.string().min(1, 'Organization ID is required'),
  leadFormId: z.string().min(1, 'Lead form ID is required'),
  leadFormName: z.string().optional(),
  pageId: z.string().optional(), // If not provided, updates the default page
});

export type SetDefaultLeadFormInput = z.infer<typeof setDefaultLeadFormSchema>;
