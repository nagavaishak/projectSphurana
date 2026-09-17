import { z } from 'zod';

export const checkAdminAccessSchema = z.object({
  userId: z.string().min(1, 'User ID is required'),
  organizationId: z.string().min(1, 'Organization ID is required'),
});

export type CheckAdminAccessInput = z.infer<typeof checkAdminAccessSchema>;
