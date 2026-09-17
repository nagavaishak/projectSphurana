import { z } from 'zod';

export const testEmailSchema = z.object({
  emailAccountId: z.string().min(1, 'Email account ID is required'),
  to: z.string().email('Valid email address is required'),
  subject: z.string().min(1, 'Subject is required'),
  body: z.string().min(1, 'Body is required'),
  organizationId: z.string().min(1, 'Organization ID is required'),
});

export type TestEmailInput = z.infer<typeof testEmailSchema>;
