import { clockInSchema } from '@borradh-workspace/features/timesheets';
import { createZodDto } from 'nestjs-zod';

export class ClockInDto extends createZodDto(
  clockInSchema.omit({
    organizationId: true,
    requestingUserId: true,
    canManageOthers: true,
  })
) {}
