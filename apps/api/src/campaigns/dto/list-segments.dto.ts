import { listSegmentsSchema } from '@borradh-workspace/features/campaigns';
import { createZodDto } from 'nestjs-zod';

export class ListSegmentsDto extends createZodDto(
  listSegmentsSchema.omit({ organizationId: true })
) {}
