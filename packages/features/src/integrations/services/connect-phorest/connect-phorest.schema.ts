import { z } from 'zod';

export const connectPhorestSchema = z.object({
  organizationId: z.string().min(1, 'Organization ID is required'),
  userId: z.string().min(1, 'User ID is required'),
  username: z.string().min(1, 'Username is required'),
  password: z.string().min(1, 'Password is required'),
  businessId: z.string().min(1, 'Business ID is required'),
  region: z.enum(['eu', 'us']).default('eu'),
});

export type ConnectPhorestInput = z.infer<typeof connectPhorestSchema>;
