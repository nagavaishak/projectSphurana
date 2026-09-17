import { trainingCategoryValues } from '@borradh-workspace/labels';
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

// Inline schema to avoid TypeScript type depth issues with .omit().
// The enum is DERIVED from the labels vocabulary.
const listTrainingVideosDtoSchema = z.object({
  category: z.enum(trainingCategoryValues).optional(),
});

export class ListTrainingVideosDto extends createZodDto(
  listTrainingVideosDtoSchema
) {}
