import { z } from 'zod';

export const sendLeadFirstTouchSchema = z.object({
  organizationId: z.string().min(1),
  leadId: z.string().min(1),
});

export type SendLeadFirstTouchInput = z.infer<typeof sendLeadFirstTouchSchema>;
