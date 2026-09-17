import { listServicesSchema } from '@borradh-workspace/features/organization-services';
import { createZodDto } from 'nestjs-zod';

export class ListServicesDto extends createZodDto(
  listServicesSchema.omit({ organizationId: true })
) {}
