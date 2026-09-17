import { seedIntakeTemplatesSchema } from '@borradh-workspace/features/intake-forms';
import { createZodDto } from 'nestjs-zod';

// organizationId comes from @ActiveOrganization; createdById from @CurrentUser.
export class SeedIntakeTemplatesDto extends createZodDto(
  seedIntakeTemplatesSchema.omit({ organizationId: true, createdById: true })
) {}
