import { listContentBatchesSchema } from '@borradh-workspace/features/content-batches';
import { createZodDto } from 'nestjs-zod';

export class ListContentBatchesDto extends createZodDto(
  listContentBatchesSchema.omit({ organizationId: true })
) {}
