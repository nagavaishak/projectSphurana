import { z } from 'zod';

export const searchPlacesSchema = z.object({
  query: z.string().min(1, 'Search query is required').max(200),
  sessionToken: z.string().optional(),
});

export type SearchPlacesInput = z.infer<typeof searchPlacesSchema>;
