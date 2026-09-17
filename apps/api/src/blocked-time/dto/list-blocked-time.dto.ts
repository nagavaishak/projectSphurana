import { listBlockedTimeBaseSchema } from '@borradh-workspace/features/scheduling';
import { createZodDto } from 'nestjs-zod';

export class ListBlockedTimeDto extends createZodDto(
  listBlockedTimeBaseSchema.omit({ organizationId: true })
) {}
