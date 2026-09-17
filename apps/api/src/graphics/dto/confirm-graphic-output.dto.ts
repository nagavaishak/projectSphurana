import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

const confirmGraphicOutputDtoSchema = z.object({
  objectKey: z.string().min(1, 'Object key is required'),
  slideId: z.string().min(1, 'Slide ID is required'),
  slideOrder: z.number().int().min(0),
  format: z.enum(['png', 'jpg', 'webp']),
  width: z.number().int().positive().max(10000),
  height: z.number().int().positive().max(10000),
});

export class ConfirmGraphicOutputDto extends createZodDto(
  confirmGraphicOutputDtoSchema
) {}
