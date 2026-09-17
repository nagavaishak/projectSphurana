import { createCategoryRequestSchema } from '@borradh-workspace/contracts';
import { createZodDto } from 'nestjs-zod';

/**
 * `POST /service-categories` body. Validated against the CANONICAL wire
 * contract; the controller injects `organizationId` from the active-org
 * session.
 */
export class CreateCategoryDto extends createZodDto(
  createCategoryRequestSchema
) {}
