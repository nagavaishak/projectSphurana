import { addCatalogLocationsRequestSchema } from '@borradh-workspace/contracts';
import { createZodDto } from 'nestjs-zod';

/**
 * `POST /offers/:id/locations` body — "run this promotion at these branches
 * too". ADDITIVE; the offer editor's PUT replaces the whole set.
 */
export class AddOfferLocationsDto extends createZodDto(
  addCatalogLocationsRequestSchema
) {}
