import { updateTimeEntrySchema } from '@borradh-workspace/features/timesheets';
import { createZodDto } from 'nestjs-zod';

export class UpdateTimeEntryDto extends createZodDto(
  updateTimeEntrySchema.omit({ organizationId: true, timeEntryId: true })
) {}
