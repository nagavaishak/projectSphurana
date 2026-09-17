import { updateIntakeFormSchema } from '@borradh-workspace/features/intake-forms';
import { createZodDto } from 'nestjs-zod';

// organizationId comes from @ActiveOrganization; id from the route param.
export class UpdateIntakeFormDto extends createZodDto(
  updateIntakeFormSchema.omit({ organizationId: true, id: true })
) {}
