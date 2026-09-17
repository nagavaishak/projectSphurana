import { updateLocationVenueSchema } from '@borradh-workspace/features/venue';
import { createZodDto } from 'nestjs-zod';

// organizationId comes from the session; locationId comes from the route param.
export class UpdateLocationVenueDto extends createZodDto(
  updateLocationVenueSchema.omit({ organizationId: true, locationId: true })
) {}
