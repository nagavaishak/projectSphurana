import { reorderOrganizationPhotosSchema } from '@borradh-workspace/features/venue';
import { createZodDto } from 'nestjs-zod';

export class ReorderOrganizationPhotosDto extends createZodDto(
  reorderOrganizationPhotosSchema.omit({ organizationId: true })
) {}
