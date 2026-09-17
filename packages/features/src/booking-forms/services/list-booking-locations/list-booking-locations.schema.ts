import { z } from 'zod';

export const listBookingLocationsSchema = z.object({
  organizationSlug: z.string().min(1, 'Organization slug is required'),
});

export type ListBookingLocationsInput = z.infer<
  typeof listBookingLocationsSchema
>;
