import { z } from 'zod';

export const revokeWhatsappLinkSchema = z.object({
  /** The pairing row id to revoke. */
  id: z.string().min(1),
  /** Owner asserting the revoke — must own the row. */
  userId: z.string().min(1),
});

export type RevokeWhatsappLinkInput = z.infer<typeof revokeWhatsappLinkSchema>;
