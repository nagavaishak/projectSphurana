import { updateProductCategorySchema } from '@borradh-workspace/features/inventory';
import { createZodDto } from 'nestjs-zod';

export class UpdateProductCategoryDto extends createZodDto(
  updateProductCategorySchema.omit({ id: true, organizationId: true })
) {}
