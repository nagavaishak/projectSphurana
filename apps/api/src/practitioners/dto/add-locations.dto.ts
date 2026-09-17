import { addCatalogLocationsRequestSchema } from '@borradh-workspace/contracts';
import { createZodDto } from 'nestjs-zod';

/**
 * `POST /practitioners/:id/locations` body — "this person also works at these
 * branches". ADDITIVE; the PUT beside it replaces the whole set, which is how
 * a short list quietly takes someone OFF a branch they have bookings at.
 */
export class AddLocationsDto extends createZodDto(
  addCatalogLocationsRequestSchema
) {}
