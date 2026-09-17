import { listTimeOffBaseSchema } from '@borradh-workspace/features/scheduling';
import { createZodDto } from 'nestjs-zod';

export class ListTimeOffDto extends createZodDto(
  listTimeOffBaseSchema.omit({ organizationId: true })
) {}
