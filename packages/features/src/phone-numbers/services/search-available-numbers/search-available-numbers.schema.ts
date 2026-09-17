import { z } from 'zod';

export const searchAvailableNumbersSchema = z.object({
  countryCode: z.string().length(2, 'Country code must be 2 characters'),
  city: z.string().optional(),
  state: z.string().optional(),
  areaCode: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(50).optional().default(10),
});

export type SearchAvailableNumbersInput = z.infer<
  typeof searchAvailableNumbersSchema
>;
