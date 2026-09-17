import { createServiceVariantSchema } from '@borradh-workspace/features/organization-services';
import { createZodDto } from 'nestjs-zod';

// serviceId comes from the route param, organizationId from the active-org context.
export class CreateServiceVariantDto extends createZodDto(
  createServiceVariantSchema.omit({ organizationId: true, serviceId: true })
) {}
