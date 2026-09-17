import { updateLocationRequestSchema } from '@borradh-workspace/contracts';
import { createZodDto } from 'nestjs-zod';

/** `PUT /organization-locations/:id` body — the canonical wire contract. */
export class UpdateLocationDto extends createZodDto(
  updateLocationRequestSchema
) {}
