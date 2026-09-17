import { updateWageConfigRequestSchema } from '@borradh-workspace/contracts';
import { createZodDto } from 'nestjs-zod';

/** Body for PUT /wage-configs/:practitionerId (practitionerId is a route param). */
export class UpdateWageConfigDto extends createZodDto(
  updateWageConfigRequestSchema
) {}
