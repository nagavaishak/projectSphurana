import { z } from 'zod';

export const selectPhoneNumberSchema = z.object({
  organizationId: z.string().min(1),
  leadId: z.string().optional(),
});

export type SelectPhoneNumberInput = z.infer<typeof selectPhoneNumberSchema>;
