import { updateConsentFormTemplateSchema } from '@borradh-workspace/features/consent-forms';
import { createZodDto } from 'nestjs-zod';

export class UpdateConsentFormTemplateDto extends createZodDto(
  updateConsentFormTemplateSchema.omit({ id: true, organizationId: true })
) {}
