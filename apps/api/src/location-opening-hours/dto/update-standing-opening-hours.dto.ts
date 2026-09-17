import { updateStandingOpeningHoursSchema } from '@borradh-workspace/features/location-opening-hours';
import { createZodDto } from 'nestjs-zod';

export class UpdateStandingOpeningHoursDto extends createZodDto(
  updateStandingOpeningHoursSchema.omit({
    organizationId: true,
    locationId: true,
  })
) {}
