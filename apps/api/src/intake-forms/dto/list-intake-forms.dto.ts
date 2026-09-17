import { listIntakeFormsSchema } from '@borradh-workspace/features/intake-forms';
import { createZodDto } from 'nestjs-zod';

export class ListIntakeFormsDto extends createZodDto(
  listIntakeFormsSchema.omit({ organizationId: true })
) {}
