import { z } from 'zod';

export const listProductsSchema = z.object({
  organizationId: z.string().min(1),
  search: z.string().min(1).optional(),
  categoryId: z.string().min(1).optional(),
  brandId: z.string().min(1).optional(),
  supplierId: z.string().min(1).optional(),
  /**
   * Branch filter, from the validated `X-Location-Id` header. One SKU can be
   * stocked at several branches, so this reads `product_location` with the
   * usual "zero join rows = sold everywhere" default. Per-branch QUANTITY
   * still lives in `product_stock` and is unaffected.
   */
  locationId: z.string().min(1).optional(),
  includeInactive: z.coerce.boolean().default(false),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

export type ListProductsInput = z.input<typeof listProductsSchema>;
