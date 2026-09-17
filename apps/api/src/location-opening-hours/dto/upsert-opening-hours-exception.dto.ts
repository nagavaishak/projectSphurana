import { upsertOpeningHoursExceptionBaseSchema } from '@borradh-workspace/features/location-opening-hours';
import { createZodDto } from 'nestjs-zod';

export class UpsertOpeningHoursExceptionDto extends createZodDto(
  upsertOpeningHoursExceptionBaseSchema.omit({
    organizationId: true,
    locationId: true,
    date: true,
    createdById: true,
  })
) {}
