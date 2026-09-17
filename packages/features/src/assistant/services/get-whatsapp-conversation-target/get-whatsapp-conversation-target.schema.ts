import { z } from 'zod';

export const getWhatsappConversationTargetSchema = z.object({
  conversationId: z.string().min(1),
  organizationId: z.string().min(1),
});

export type GetWhatsappConversationTargetInput = z.infer<
  typeof getWhatsappConversationTargetSchema
>;
