import { graphicStatusValues } from '@borradh-workspace/labels';
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

// Inline schema to avoid TypeScript type depth issues with .omit().
// The enum is DERIVED from the labels vocabulary.
const listGraphicsDtoSchema = z.object({
  status: z.enum(graphicStatusValues).optional(),
  limit: z.coerce.number().min(1).max(100).default(20),
  offset: z.coerce.number().min(0).default(0),
});

export class ListGraphicsDto extends createZodDto(listGraphicsDtoSchema) {}
