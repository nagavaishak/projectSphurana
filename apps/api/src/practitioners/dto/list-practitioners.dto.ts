import { listPractitionersSchema } from '@borradh-workspace/features/practitioners';
import { createZodDto } from 'nestjs-zod';

export class ListPractitionersDto extends createZodDto(
  listPractitionersSchema.omit({ organizationId: true })
) {}
