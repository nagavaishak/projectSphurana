import { z } from 'zod';

export const listWhatsAppAccountsSchema = z.object({
  organizationId: z.string().min(1, 'Organization ID is required'),
});

export type ListWhatsAppAccountsInput = z.infer<
  typeof listWhatsAppAccountsSchema
>;
