import { z } from 'zod';

export const listDriveAccountsSchema = z.object({
  organizationId: z.string().min(1, 'Organization ID is required'),
});

export type ListDriveAccountsInput = z.infer<typeof listDriveAccountsSchema>;
