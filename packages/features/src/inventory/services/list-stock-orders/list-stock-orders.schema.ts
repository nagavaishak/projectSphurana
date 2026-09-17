import { stockOrderStatusValues } from '@borradh-workspace/database';
import { z } from 'zod';

export const listStockOrdersSchema = z.object({
  organizationId: z.string().min(1),
  status: z.enum(stockOrderStatusValues).optional(),
  supplierId: z.string().min(1).optional(),
  locationId: z.string().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

export type ListStockOrdersInput = z.input<typeof listStockOrdersSchema>;
