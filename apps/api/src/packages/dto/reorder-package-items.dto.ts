import { reorderPackageItemsSchema } from '@borradh-workspace/features/packages';
import { createZodDto } from 'nestjs-zod';

export class ReorderPackageItemsDto extends createZodDto(
  reorderPackageItemsSchema.omit({ packageId: true, organizationId: true })
) {}
