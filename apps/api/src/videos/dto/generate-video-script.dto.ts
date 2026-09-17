import { generateVideoScriptRequestSchema } from '@borradh-workspace/contracts';
import { createZodDto } from 'nestjs-zod';

export class GenerateVideoScriptDto extends createZodDto(
  generateVideoScriptRequestSchema
) {}
