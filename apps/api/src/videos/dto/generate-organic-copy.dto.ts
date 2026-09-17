import { generateOrganicCopyRequestSchema } from '@borradh-workspace/contracts';
import { createZodDto } from 'nestjs-zod';

export class GenerateOrganicCopyDto extends createZodDto(
  generateOrganicCopyRequestSchema
) {}
