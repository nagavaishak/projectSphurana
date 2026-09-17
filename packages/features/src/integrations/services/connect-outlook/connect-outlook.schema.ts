import { z } from 'zod';

export const connectOutlookSchema = z.object({
  organizationId: z.string().min(1, 'Organization ID is required'),
  code: z.string().min(1, 'Authorization code is required'),
});

export type ConnectOutlookInput = z.infer<typeof connectOutlookSchema>;
