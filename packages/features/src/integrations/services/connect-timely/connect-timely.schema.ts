import { z } from 'zod';

export const connectTimelySchema = z.object({
  organizationId: z.string().min(1, 'Organization ID is required'),
  userId: z.string().min(1, 'User ID is required'),
  code: z.string().min(1, 'Authorization code is required'),
});

export type ConnectTimelyInput = z.infer<typeof connectTimelySchema>;
