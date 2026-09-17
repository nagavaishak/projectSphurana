import { createStockTakeSchema } from '@borradh-workspace/features/inventory';
import { createZodDto } from 'nestjs-zod';

export class CreateStockTakeDto extends createZodDto(
  createStockTakeSchema.omit({ organizationId: true, createdById: true })
) {}
