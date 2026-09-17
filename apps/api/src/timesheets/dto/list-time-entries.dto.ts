import { listTimeEntriesSchema } from '@borradh-workspace/features/timesheets';
import { createZodDto } from 'nestjs-zod';

export class ListTimeEntriesDto extends createZodDto(
  listTimeEntriesSchema.omit({ organizationId: true })
) {}
