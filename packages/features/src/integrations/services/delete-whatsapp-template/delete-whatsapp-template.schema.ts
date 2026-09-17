import { z } from 'zod';

export const deleteWhatsappTemplateSchema = z.object({
  organizationId: z.string().min(1),
  accountId: z.string().min(1),
  templateName: z.string().min(1),
});

export type DeleteWhatsappTemplateInput = z.infer<
  typeof deleteWhatsappTemplateSchema
>;
