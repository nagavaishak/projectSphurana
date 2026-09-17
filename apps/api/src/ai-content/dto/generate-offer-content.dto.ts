import { generateOfferContentRequestSchema } from '@borradh-workspace/contracts';
import { createZodDto } from 'nestjs-zod';

export class GenerateOfferContentDto extends createZodDto(
  generateOfferContentRequestSchema
) {}
