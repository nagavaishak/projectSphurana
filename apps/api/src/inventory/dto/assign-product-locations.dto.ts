import { assignEntityLocationsRequestSchema } from '@borradh-workspace/contracts';
import { createZodDto } from 'nestjs-zod';

/** `PUT /products/:id/locations` body — the canonical wire contract. */
export class AssignProductLocationsDto extends createZodDto(
  assignEntityLocationsRequestSchema
) {}
