import { stockTakeStatusValues } from '@borradh-workspace/database';
import { z } from 'zod';

export const listStockTakesSchema = z.object({
  organizationId: z.string().min(1),
  status: z.enum(stockTakeStatusValues).optional(),
  locationId: z.string().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

export type ListStockTakesInput = z.input<typeof listStockTakesSchema>;
