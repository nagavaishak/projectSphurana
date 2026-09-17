import { z } from 'zod';

export const listEmailAccountsSchema = z.object({
  organizationId: z.string().min(1, 'Organization ID is required'),
});

export type ListEmailAccountsInput = z.infer<typeof listEmailAccountsSchema>;
