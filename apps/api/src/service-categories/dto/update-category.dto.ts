import { updateCategoryRequestSchema } from '@borradh-workspace/contracts';
import { createZodDto } from 'nestjs-zod';

/**
 * `PUT /service-categories/:id` body. Validated against the CANONICAL wire
 * contract — `id` is the route param, `organizationId` the session's active
 * org.
 */
export class UpdateCategoryDto extends createZodDto(
  updateCategoryRequestSchema
) {}
