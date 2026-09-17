import { locationCatalogSeedRequestSchema } from '@borradh-workspace/contracts';
import { createZodDto } from 'nestjs-zod';

/** `PUT /organization-locations/:id/catalog` body — the canonical wire contract. */
export class ApplyLocationCatalogDto extends createZodDto(
  locationCatalogSeedRequestSchema
) {}
