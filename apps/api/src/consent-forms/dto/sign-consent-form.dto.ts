import { signConsentFormSchema } from '@borradh-workspace/features/consent-forms';
import { createZodDto } from 'nestjs-zod';

export class SignConsentFormDto extends createZodDto(
  signConsentFormSchema.omit({
    leadId: true,
    organizationId: true,
    submissionId: true,
    // Captured server-side from the request — never client-supplied.
    signedIp: true,
  })
) {}
