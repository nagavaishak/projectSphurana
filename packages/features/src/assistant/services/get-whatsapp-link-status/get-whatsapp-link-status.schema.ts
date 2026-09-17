import { z } from 'zod';

export const getWhatsappLinkStatusSchema = z.object({
  userId: z.string().min(1),
  organizationId: z.string().min(1),
});

export type GetWhatsappLinkStatusInput = z.infer<
  typeof getWhatsappLinkStatusSchema
>;

export interface WhatsappLinkStatus {
  /** The most relevant link for this owner, or null if none exists. */
  link: {
    id: string;
    status: 'pending' | 'active' | 'revoked';
    phoneE164: string | null;
    verifiedAt: Date | null;
    createdAt: Date;
  } | null;
}
