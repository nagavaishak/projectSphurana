import { z } from 'zod';

export const listGoogleMyBusinessAccountsSchema = z.object({
  organizationId: z.string().min(1, 'Organization ID is required'),
});

export type ListGoogleMyBusinessAccountsInput = z.infer<
  typeof listGoogleMyBusinessAccountsSchema
>;
