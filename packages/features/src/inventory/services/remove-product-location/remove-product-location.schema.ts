import { z } from 'zod';

/**
 * Schema for taking ONE branch off a product.
 *
 * No wire body — both ids are route params (`DELETE /…/:id/locations/:locationId`)
 * and `organizationId` comes from the session, so there is nothing for a
 * request contract to describe.
 */
export const removeProductLocationSchema = z.object({
  productId: z.string().min(1, 'Product ID is required'),
  locationId: z.string().min(1, 'Location ID is required'),
  organizationId: z.string().min(1, 'Organization ID is required'),
});

export type RemoveProductLocationInput = z.infer<
  typeof removeProductLocationSchema
>;
