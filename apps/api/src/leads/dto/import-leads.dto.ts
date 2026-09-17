import { importLeadsSchema } from '@borradh-workspace/features/leads';
import { createZodDto } from 'nestjs-zod';

export class ImportLeadsDto extends createZodDto(
  importLeadsSchema.omit({ organizationId: true })
) {}
