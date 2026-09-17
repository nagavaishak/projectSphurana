import { z } from 'zod';

export const buyPhoneNumberSchema = z.object({
  organizationId: z.string().min(1),
  phoneNumber: z.string().min(1, 'Phone number is required'),
  label: z.string().optional(),
  countryCode: z.string().length(2).optional(),
});

export type BuyPhoneNumberInput = z.infer<typeof buyPhoneNumberSchema>;
