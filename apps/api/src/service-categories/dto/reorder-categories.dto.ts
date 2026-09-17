import { reorderCategoriesSchema } from '@borradh-workspace/features/service-categories';
import { createZodDto } from 'nestjs-zod';

export class ReorderCategoriesDto extends createZodDto(
  reorderCategoriesSchema.omit({ organizationId: true })
) {}
