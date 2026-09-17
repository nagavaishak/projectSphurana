import { updateStockOrderSchema } from '@borradh-workspace/features/inventory';
import { createZodDto } from 'nestjs-zod';

export class UpdateStockOrderDto extends createZodDto(
  updateStockOrderSchema.omit({ id: true, organizationId: true })
) {}
