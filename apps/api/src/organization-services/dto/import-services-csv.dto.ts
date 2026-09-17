import { importServicesCsvSchema } from '@borradh-workspace/features/organization-services';
import { createZodDto } from 'nestjs-zod';

export class ImportServicesCsvDto extends createZodDto(
  importServicesCsvSchema.omit({ organizationId: true })
) {}
