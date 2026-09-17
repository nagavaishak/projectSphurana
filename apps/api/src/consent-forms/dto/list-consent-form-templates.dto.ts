import { listConsentFormTemplatesSchema } from '@borradh-workspace/features/consent-forms';
import { createZodDto } from 'nestjs-zod';

export class ListConsentFormTemplatesDto extends createZodDto(
  listConsentFormTemplatesSchema.omit({ organizationId: true })
) {}
