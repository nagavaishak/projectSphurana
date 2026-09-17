import { z } from 'zod';

export const testSmsSchema = z.object({
  to: z.string().min(1, 'Phone number is required'),
  message: z.string().min(1, 'Message is required'),
  organizationId: z.string().min(1, 'Organization ID is required'),
});

export type TestSmsInput = z.infer<typeof testSmsSchema>;
