import { assignCatalogLocationsRequestSchema } from '@borradh-workspace/contracts';
import { createZodDto } from 'nestjs-zod';

/**
 * `PUT /organization-services/:id/locations` body — the canonical wire
 * contract. Note that an empty `locations` array is VALID and means "offered
 * at every branch"; see the contract for why.
 */
export class AssignServiceLocationsDto extends createZodDto(
  assignCatalogLocationsRequestSchema
) {}
