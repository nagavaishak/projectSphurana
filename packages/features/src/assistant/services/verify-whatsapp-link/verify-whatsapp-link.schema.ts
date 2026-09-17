import { z } from 'zod';

export const verifyWhatsappLinkSchema = z.object({
  /** The numeric pairing code the owner sent to Claire. */
  code: z.string().min(1),
  /** The sender's WhatsApp number in E.164 (digits, no `+` required). */
  fromPhoneE164: z.string().min(1),
});

export type VerifyWhatsappLinkInput = z.infer<typeof verifyWhatsappLinkSchema>;

export interface VerifyWhatsappLinkOutput {
  id: string;
  userId: string;
  organizationId: string;
  phoneE164: string;
}
