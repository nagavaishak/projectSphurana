import { updateLeadFormSchema } from '@borradh-workspace/features/lead-forms';
import { createZodDto } from 'nestjs-zod';

export class UpdateLeadFormDto extends createZodDto(
  updateLeadFormSchema.omit({ id: true, organizationId: true })
) {}
