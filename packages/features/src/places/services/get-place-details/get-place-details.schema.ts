import { z } from 'zod';

export const getPlaceDetailsSchema = z.object({
  placeId: z.string().min(1, 'Place ID is required'),
  sessionToken: z.string().optional(),
});

export type GetPlaceDetailsInput = z.infer<typeof getPlaceDetailsSchema>;
