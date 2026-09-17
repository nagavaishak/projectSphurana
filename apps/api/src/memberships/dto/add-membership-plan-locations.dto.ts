import { addCatalogLocationsRequestSchema } from '@borradh-workspace/contracts';
import { createZodDto } from 'nestjs-zod';

/**
 * `POST /membership-plans/:id/locations` body — "make this available at these
 * branches too". ADDITIVE; see the contract for why import cannot go through
 * the replacing PUT.
 */
export class AddMembershipPlanLocationsDto extends createZodDto(
  addCatalogLocationsRequestSchema
) {}
