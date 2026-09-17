import { updatePackageItemSchema } from '@borradh-workspace/features/packages';
import { createZodDto } from 'nestjs-zod';

export class UpdatePackageItemDto extends createZodDto(
  updatePackageItemSchema.omit({
    packageId: true,
    itemId: true,
    organizationId: true,
  })
) {}
