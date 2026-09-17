import { updatePractitionerRequestSchema } from '@borradh-workspace/contracts';
import { createZodDto } from 'nestjs-zod';

/** `PUT /practitioners/:id` body — the canonical wire contract. `id` (route
 * param) and `organizationId` (session) are not part of the body. */
export class UpdatePractitionerDto extends createZodDto(
  updatePractitionerRequestSchema
) {}
