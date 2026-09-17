import { listStockTakesSchema } from '@borradh-workspace/features/inventory';
import { createZodDto } from 'nestjs-zod';

export class ListStockTakesDto extends createZodDto(
  listStockTakesSchema.omit({ organizationId: true })
) {}
