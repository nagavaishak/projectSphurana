import { listConsentFormSubmissionsSchema } from '@borradh-workspace/features/consent-forms';
import { createZodDto } from 'nestjs-zod';

export class ListConsentFormSubmissionsDto extends createZodDto(
  listConsentFormSubmissionsSchema.omit({ organizationId: true })
) {}
