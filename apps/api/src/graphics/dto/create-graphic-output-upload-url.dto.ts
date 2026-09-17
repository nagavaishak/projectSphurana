import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

// Inline schema to avoid TypeScript type depth issues with .omit()
const createGraphicOutputUploadUrlDtoSchema = z.object({
  slideId: z.string().min(1, 'Slide ID is required'),
  format: z.enum(['png', 'jpg', 'webp']),
  width: z.number().int().positive().max(10000),
  height: z.number().int().positive().max(10000),
  contentLength: z
    .number()
    .int()
    .positive()
    .max(20 * 1024 * 1024, 'Content length exceeds 20MB limit'),
});

export class CreateGraphicOutputUploadUrlDto extends createZodDto(
  createGraphicOutputUploadUrlDtoSchema
) {}
