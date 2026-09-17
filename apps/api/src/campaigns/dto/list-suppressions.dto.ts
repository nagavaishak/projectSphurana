import { listSuppressionsSchema } from '@borradh-workspace/features/campaigns';
import { createZodDto } from 'nestjs-zod';

export class ListSuppressionsDto extends createZodDto(
  listSuppressionsSchema.omit({ organizationId: true })
) {}
