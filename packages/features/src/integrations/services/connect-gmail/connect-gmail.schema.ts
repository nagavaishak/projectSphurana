import { z } from 'zod';

export const connectGmailSchema = z.object({
  organizationId: z.string().min(1, 'Organization ID is required'),
  code: z.string().min(1, 'Authorization code is required'),
});

export type ConnectGmailInput = z.infer<typeof connectGmailSchema>;
