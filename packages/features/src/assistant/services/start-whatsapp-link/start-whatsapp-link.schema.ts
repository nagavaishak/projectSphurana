import { z } from 'zod';

export const startWhatsappLinkSchema = z.object({
  userId: z.string().min(1),
  organizationId: z.string().min(1),
});

export type StartWhatsappLinkInput = z.infer<typeof startWhatsappLinkSchema>;

export interface StartWhatsappLinkOutput {
  /** The pairing row id (so the UI can poll status / disconnect). */
  id: string;
  /** Single-use numeric verification code the owner sends to Claire. */
  code: string;
  /** `https://wa.me/<number>?text=<code>` deep link, or a placeholder in dev. */
  waLink: string;
  /** When the code stops being valid. */
  codeExpiresAt: Date;
}
