import { assignEntityLocationsRequestSchema } from '@borradh-workspace/contracts';
import { createZodDto } from 'nestjs-zod';

/** `PUT /membership-plans/:id/locations` body — the canonical wire contract. */
export class AssignMembershipPlanLocationsDto extends createZodDto(
  assignEntityLocationsRequestSchema
) {}
