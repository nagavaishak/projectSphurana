import { z } from 'zod';

export const listWhatsappTemplatesSchema = z.object({
  organizationId: z.string().min(1),
  accountId: z.string().min(1),
});

export type ListWhatsappTemplatesInput = z.infer<
  typeof listWhatsappTemplatesSchema
>;
