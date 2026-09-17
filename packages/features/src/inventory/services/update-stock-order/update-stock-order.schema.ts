import { z } from 'zod';
import {
  stockOrderFeeInputSchema,
  stockOrderItemInputSchema,
} from '../create-stock-order/create-stock-order.schema.js';

export const updateStockOrderSchema = z.object({
  id: z.string().min(1),
  organizationId: z.string().min(1),
  supplierId: z.string().min(1).nullable().optional(),
  locationId: z.string().min(1).nullable().optional(),
  expectedByDate: z.coerce.date().nullable().optional(),
  notes: z.string().nullable().optional(),
  // Only draft -> ordered transitions happen through update; receive/cancel
  // have dedicated lifecycle endpoints.
  status: z.enum(['draft', 'ordered']).optional(),
  // Full replacement of line items / fees; only allowed while draft.
  items: z.array(stockOrderItemInputSchema).min(1).optional(),
  fees: z.array(stockOrderFeeInputSchema).optional(),
});

export type UpdateStockOrderInput = z.infer<typeof updateStockOrderSchema>;
