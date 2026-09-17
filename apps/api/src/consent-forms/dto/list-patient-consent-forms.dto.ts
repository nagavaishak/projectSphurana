import { listPatientConsentFormsSchema } from '@borradh-workspace/features/consent-forms';
import { createZodDto } from 'nestjs-zod';

export class ListPatientConsentFormsDto extends createZodDto(
  listPatientConsentFormsSchema.omit({ leadId: true, organizationId: true })
) {}
