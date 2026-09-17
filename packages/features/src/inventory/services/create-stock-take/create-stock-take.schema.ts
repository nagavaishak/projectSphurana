import { z } from 'zod';

export const createStockTakeSchema = z.object({
  organizationId: z.string().min(1),
  createdById: z.string().min(1),
  // Required at the service level: stock is per-location, and completing a
  // stock take writes counted quantities into product_stock at this location.
  locationId: z.string().min(1),
  name: z.string().min(1).nullable().optional(),
  description: z.string().nullable().optional(),
  // Explicit product selection; defaults to all active stock-tracked products
  productIds: z.array(z.string().min(1)).min(1).optional(),
});

export type CreateStockTakeInput = z.infer<typeof createStockTakeSchema>;
