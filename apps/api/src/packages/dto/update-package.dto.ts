import { updatePackageSchema } from '@borradh-workspace/features/packages';
import { createZodDto } from 'nestjs-zod';

export class UpdatePackageDto extends createZodDto(
  updatePackageSchema.omit({ id: true, organizationId: true })
) {}
