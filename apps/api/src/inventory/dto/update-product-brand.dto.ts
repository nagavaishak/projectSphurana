import { updateProductBrandSchema } from '@borradh-workspace/features/inventory';
import { createZodDto } from 'nestjs-zod';

export class UpdateProductBrandDto extends createZodDto(
  updateProductBrandSchema.omit({ id: true, organizationId: true })
) {}
