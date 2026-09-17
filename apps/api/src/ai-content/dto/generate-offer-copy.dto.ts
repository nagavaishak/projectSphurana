import { generateOfferCopyRequestSchema } from '@borradh-workspace/contracts';
import { createZodDto } from 'nestjs-zod';

export class GenerateOfferCopyDto extends createZodDto(
  generateOfferCopyRequestSchema
) {}
