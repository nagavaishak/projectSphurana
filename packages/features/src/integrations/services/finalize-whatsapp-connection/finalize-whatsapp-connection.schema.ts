import { z } from 'zod';

export const finalizeWhatsAppConnectionSchema = z.object({
  organizationId: z.string().min(1),
  connectedById: z.string().min(1),
  wabaId: z.string().min(1),
  code: z.string().min(1),
});

export type FinalizeWhatsAppConnectionInput = z.infer<
  typeof finalizeWhatsAppConnectionSchema
>;
