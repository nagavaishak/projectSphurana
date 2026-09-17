import { addCatalogLocationsRequestSchema } from '@borradh-workspace/contracts';
import { createZodDto } from 'nestjs-zod';

/**
 * `POST /organization-services/:id/locations` body — "offer this at these
 * branches too". ADDITIVE; see the contract for why import cannot go through
 * the replacing PUT.
 */
export class AddServiceLocationsDto extends createZodDto(
  addCatalogLocationsRequestSchema
) {}
