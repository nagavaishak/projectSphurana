import { listStockOrdersSchema } from '@borradh-workspace/features/inventory';
import { createZodDto } from 'nestjs-zod';

export class ListStockOrdersDto extends createZodDto(
  listStockOrdersSchema.omit({ organizationId: true })
) {}
