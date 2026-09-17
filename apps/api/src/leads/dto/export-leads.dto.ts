import { exportLeadsSchema } from '@borradh-workspace/features/leads';
import { createZodDto } from 'nestjs-zod';

export class ExportLeadsDto extends createZodDto(
  exportLeadsSchema.omit({ organizationId: true })
) {}
