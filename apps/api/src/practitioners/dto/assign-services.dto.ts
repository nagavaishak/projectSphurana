import { assignPractitionerServicesRequestSchema } from '@borradh-workspace/contracts';
import { createZodDto } from 'nestjs-zod';

/** `PUT /practitioners/:id/services` body — the canonical wire contract. */
export class AssignServicesDto extends createZodDto(
  assignPractitionerServicesRequestSchema
) {}
