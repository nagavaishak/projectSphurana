import { z } from 'zod';

export const releasePhoneNumberSchema = z.object({
  id: z.string().min(1),
  organizationId: z.string().min(1),
});

export type ReleasePhoneNumberInput = z.infer<typeof releasePhoneNumberSchema>;
