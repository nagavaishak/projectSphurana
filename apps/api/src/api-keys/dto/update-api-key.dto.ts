import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

const updateApiKeyBodySchema = z.object({
  name: z.string().min(1).max(100).optional(),
  enabled: z.boolean().optional(),
});

export class UpdateApiKeyDto extends createZodDto(updateApiKeyBodySchema) {}
