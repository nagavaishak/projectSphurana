import { submitIntakeFormSchema } from '@borradh-workspace/features/intake-forms';
import { createZodDto } from 'nestjs-zod';

// organizationSlug and token come from the route params, not the body.
export class SubmitIntakeFormDto extends createZodDto(
  submitIntakeFormSchema.omit({ organizationSlug: true, token: true })
) {}
