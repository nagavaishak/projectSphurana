import { setAxisOverrideSchema } from '@borradh-workspace/features/claire';
import { createZodDto } from 'nestjs-zod';

// organizationId comes from @ActiveOrganization, userId from @CurrentUser
export class OverrideAxesDto extends createZodDto(
  setAxisOverrideSchema.omit({ organizationId: true, userId: true })
) {}
