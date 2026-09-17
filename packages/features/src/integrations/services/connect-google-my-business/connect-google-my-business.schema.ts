import { z } from 'zod';

export const connectGoogleMyBusinessSchema = z.object({
  organizationId: z.string().min(1, 'Organization ID is required'),
  userId: z.string().min(1, 'User ID is required'),
  code: z.string().min(1, 'Authorization code is required'),
  locationId: z.string().min(1, 'Location ID is required'),
  accountName: z.string().min(1, 'Account name is required'),
});

export type ConnectGoogleMyBusinessInput = z.infer<
  typeof connectGoogleMyBusinessSchema
>;
