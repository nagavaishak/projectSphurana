import { listLocationsSchema } from '@borradh-workspace/features/organization-locations';
import { createZodDto } from 'nestjs-zod';

export class ListLocationsDto extends createZodDto(
  listLocationsSchema.omit({ organizationId: true })
) {}
