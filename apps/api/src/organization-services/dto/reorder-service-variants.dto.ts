import { reorderServiceVariantsSchema } from '@borradh-workspace/features/organization-services';
import { createZodDto } from 'nestjs-zod';

// serviceId comes from the route param, organizationId from the active-org context.
export class ReorderServiceVariantsDto extends createZodDto(
  reorderServiceVariantsSchema.omit({ organizationId: true, serviceId: true })
) {}
