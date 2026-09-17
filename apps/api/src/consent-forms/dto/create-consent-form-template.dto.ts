import { createConsentFormTemplateSchema } from '@borradh-workspace/features/consent-forms';
import { createZodDto } from 'nestjs-zod';

export class CreateConsentFormTemplateDto extends createZodDto(
  createConsentFormTemplateSchema.omit({ organizationId: true })
) {}
