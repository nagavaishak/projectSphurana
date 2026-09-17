import { setServiceFormRequirementsSchema } from '@borradh-workspace/features/consent-forms';
import { createZodDto } from 'nestjs-zod';

export class SetServiceFormRequirementsDto extends createZodDto(
  setServiceFormRequirementsSchema.omit({
    organizationId: true,
    serviceId: true,
  })
) {}
