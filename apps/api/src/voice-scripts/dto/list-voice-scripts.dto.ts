import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

// Inline schema to avoid TypeScript type depth issues with .omit()
const listVoiceScriptsDtoSchema = z.object({
  limit: z.coerce.number().min(1).max(100).default(20),
  offset: z.coerce.number().min(0).default(0),
});

export class ListVoiceScriptsDto extends createZodDto(
  listVoiceScriptsDtoSchema
) {}
