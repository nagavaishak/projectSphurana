import { setServiceIntakeFormsSchema } from '@borradh-workspace/features/intake-forms';
import { createZodDto } from 'nestjs-zod';

// organizationId comes from @ActiveOrganization; serviceId from the route param.
export class SetServiceIntakeFormsDto extends createZodDto(
  setServiceIntakeFormsSchema.omit({ organizationId: true, serviceId: true })
) {}
