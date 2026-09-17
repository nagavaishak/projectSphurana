import { createLocationRequestSchema } from '@borradh-workspace/contracts';
import { createZodDto } from 'nestjs-zod';

/** `POST /organization-locations` body — the canonical wire contract. */
export class CreateLocationDto extends createZodDto(
  createLocationRequestSchema
) {}
