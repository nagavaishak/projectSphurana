import { z } from 'zod';

export const searchSmsNumbersSchema = z.object({
  organizationId: z.string().min(1, 'Organization ID is required'),
  /** ISO 3166-1 alpha-2 country code (e.g. US, IE, GB). */
  country: z
    .string()
    .length(2, 'Country must be a 2-letter code')
    .transform((c) => c.toUpperCase())
    .default('US'),
  areaCode: z.string().min(1).max(6).optional(),
  limit: z.coerce.number().int().min(1).max(20).default(5),
});

export type SearchSmsNumbersInput = z.infer<typeof searchSmsNumbersSchema>;
