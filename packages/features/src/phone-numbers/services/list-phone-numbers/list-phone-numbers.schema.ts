import { z } from 'zod';

export const listPhoneNumbersSchema = z.object({
  organizationId: z.string().min(1),
  includeReleased: z.boolean().optional().default(false),
});

export type ListPhoneNumbersInput = z.input<typeof listPhoneNumbersSchema>;
