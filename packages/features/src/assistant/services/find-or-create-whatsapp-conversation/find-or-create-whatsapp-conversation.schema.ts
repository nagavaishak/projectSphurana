import { z } from 'zod';

export const findOrCreateWhatsappConversationSchema = z.object({
  organizationId: z.string().min(1),
  userId: z.string().min(1),
  /** The owner's paired E.164 number (digits only, no '+') for this channel. */
  whatsappPhoneE164: z.string().min(1),
});

export type FindOrCreateWhatsappConversationInput = z.infer<
  typeof findOrCreateWhatsappConversationSchema
>;
