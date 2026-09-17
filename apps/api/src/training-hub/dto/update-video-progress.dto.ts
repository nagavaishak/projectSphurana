import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

// Inline schema to avoid deep type recursion from .omit() operations
const updateVideoProgressBodySchema = z.object({
  watchedSeconds: z.number().min(0, 'Watched seconds must be non-negative'),
});

export class UpdateVideoProgressDto extends createZodDto(
  updateVideoProgressBodySchema
) {}
