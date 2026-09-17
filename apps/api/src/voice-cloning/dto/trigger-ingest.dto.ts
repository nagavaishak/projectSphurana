import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

const triggerIngestSchema = z.object({
  metaAdsPageId: z.string().min(1),
});

export class TriggerIngestDto extends createZodDto(triggerIngestSchema) {}
