import { updateResourceSchema } from '@borradh-workspace/features/resources';
import { createZodDto } from 'nestjs-zod';

/** Body for PUT /resources/:id. `id` is the route param. */
export class UpdateResourceDto extends createZodDto(
  updateResourceSchema.omit({ id: true, organizationId: true })
) {}
