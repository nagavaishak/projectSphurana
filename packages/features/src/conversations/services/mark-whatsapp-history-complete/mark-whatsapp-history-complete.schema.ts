import { z } from 'zod';

export const markWhatsappHistoryCompleteSchema = z.object({
  /** phone_number_id of the WhatsApp Business Account phone to stamp */
  phoneNumberId: z.string().min(1),
});

export type MarkWhatsappHistoryCompleteInput = z.infer<
  typeof markWhatsappHistoryCompleteSchema
>;
