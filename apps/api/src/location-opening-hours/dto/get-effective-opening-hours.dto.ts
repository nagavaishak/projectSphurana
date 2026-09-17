import { getEffectiveOpeningHoursBaseSchema } from '@borradh-workspace/features/location-opening-hours';
import { createZodDto } from 'nestjs-zod';

export class GetEffectiveOpeningHoursDto extends createZodDto(
  getEffectiveOpeningHoursBaseSchema.omit({
    organizationId: true,
    locationId: true,
  })
) {}
