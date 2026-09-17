import { createIntakeFormSchema } from '@borradh-workspace/features/intake-forms';
import { createZodDto } from 'nestjs-zod';

// organizationId comes from @ActiveOrganization; createdById from @CurrentUser.
export class CreateIntakeFormDto extends createZodDto(
  createIntakeFormSchema.omit({ organizationId: true, createdById: true })
) {}
