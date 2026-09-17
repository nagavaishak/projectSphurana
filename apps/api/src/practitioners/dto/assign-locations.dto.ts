import { assignPractitionerLocationsRequestSchema } from '@borradh-workspace/contracts';
import { createZodDto } from 'nestjs-zod';

/** `PUT /practitioners/:id/locations` body — the canonical wire contract. */
export class AssignLocationsDto extends createZodDto(
  assignPractitionerLocationsRequestSchema
) {}
