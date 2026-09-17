import { addCatalogLocationsRequestSchema } from '@borradh-workspace/contracts';
import { createZodDto } from 'nestjs-zod';

/**
 * `POST /products/:id/locations` body — "make this available at these
 * branches too". ADDITIVE; see the contract for why import cannot go through
 * the replacing PUT.
 */
export class AddProductLocationsDto extends createZodDto(
  addCatalogLocationsRequestSchema
) {}
