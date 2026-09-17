import { clockOutSchema } from '@borradh-workspace/features/timesheets';
import { createZodDto } from 'nestjs-zod';

export class ClockOutDto extends createZodDto(
  clockOutSchema.omit({
    organizationId: true,
    timeEntryId: true,
    requestingUserId: true,
    canManageOthers: true,
  })
) {}
