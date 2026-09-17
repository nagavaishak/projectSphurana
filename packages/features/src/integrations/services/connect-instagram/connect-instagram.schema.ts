import { z } from 'zod';

export const connectInstagramSchema = z.object({
  organizationId: z.string().min(1),
  userId: z.string().min(1),
  code: z.string().min(1),
});

export type ConnectInstagramInput = z.infer<typeof connectInstagramSchema>;
