import { generateContentRequestSchema } from '@borradh-workspace/contracts';
import { createZodDto } from 'nestjs-zod';

export class GenerateContentDto extends createZodDto(
  generateContentRequestSchema
) {}
