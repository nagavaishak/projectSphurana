import { updateResourceCategorySchema } from '@borradh-workspace/features/resources';
import { createZodDto } from 'nestjs-zod';

/** Body for PUT /resources/categories/:id. `id` is the route param. */
export class UpdateResourceCategoryDto extends createZodDto(
  updateResourceCategorySchema.omit({ id: true, organizationId: true })
) {}
