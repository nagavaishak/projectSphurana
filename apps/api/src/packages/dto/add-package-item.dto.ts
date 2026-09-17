import { addPackageItemSchema } from '@borradh-workspace/features/packages';
import { createZodDto } from 'nestjs-zod';

export class AddPackageItemDto extends createZodDto(
  addPackageItemSchema.omit({ packageId: true, organizationId: true })
) {}
