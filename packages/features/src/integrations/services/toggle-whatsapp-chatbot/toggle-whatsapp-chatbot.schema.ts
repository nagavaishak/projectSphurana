import { z } from 'zod';

export const toggleWhatsAppChatbotSchema = z.object({
  organizationId: z.string().min(1),
  accountId: z.string().min(1),
  enabled: z.boolean(),
});

export type ToggleWhatsAppChatbotInput = z.infer<
  typeof toggleWhatsAppChatbotSchema
>;
