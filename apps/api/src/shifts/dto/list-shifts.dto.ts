import { listShiftsBaseSchema } from '@borradh-workspace/features/scheduling';
import { createZodDto } from 'nestjs-zod';

export class ListShiftsDto extends createZodDto(
  listShiftsBaseSchema.omit({ organizationId: true })
) {}
