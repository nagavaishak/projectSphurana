import { importLeadsCsvSchema } from '@borradh-workspace/features/leads';
import { createZodDto } from 'nestjs-zod';

export class ImportLeadsCsvDto extends createZodDto(
  importLeadsCsvSchema.omit({ organizationId: true })
) {}
