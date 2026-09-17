import { z } from 'zod';

export const disconnectDriveAccountSchema = z.object({
  organizationId: z.string().min(1, 'Organization ID is required'),
  accountId: z.string().min(1, 'Account ID is required'),
});

export type DisconnectDriveAccountInput = z.infer<
  typeof disconnectDriveAccountSchema
>;
