import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

const syncLeadFormDtoSchema = z.object({
  metaPageId: z.string().optional(),
});

export class SyncLeadFormDto extends createZodDto(syncLeadFormDtoSchema) {}
