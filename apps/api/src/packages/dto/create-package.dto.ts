import { createPackageSchema } from '@borradh-workspace/features/packages';
import { createZodDto } from 'nestjs-zod';

export class CreatePackageDto extends createZodDto(
  createPackageSchema.omit({ organizationId: true })
) {}
