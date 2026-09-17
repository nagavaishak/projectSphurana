import { z } from 'zod';

export const addPhoneNumberSchema = z.object({
  organizationId: z.string().min(1),
  number: z.string().min(1, 'Phone number is required'),
  label: z.string().optional(),
  countryCode: z.string().length(2).optional(),
});

export type AddPhoneNumberInput = z.infer<typeof addPhoneNumberSchema>;
