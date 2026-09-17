import { listProductsSchema } from '@borradh-workspace/features/inventory';
import { createZodDto } from 'nestjs-zod';

export class ListProductsDto extends createZodDto(
  listProductsSchema.omit({ organizationId: true })
) {}
