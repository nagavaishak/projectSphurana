import { generateConsentFormTemplateSchema } from '@borradh-workspace/features/consent-forms';
import { createZodDto } from 'nestjs-zod';

export class GenerateConsentFormTemplateDto extends createZodDto(
  generateConsentFormTemplateSchema.omit({ organizationId: true })
) {}
