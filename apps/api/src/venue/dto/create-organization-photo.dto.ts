import { createOrganizationPhotoSchema } from '@borradh-workspace/features/venue';
import { createZodDto } from 'nestjs-zod';

export class CreateOrganizationPhotoDto extends createZodDto(
  createOrganizationPhotoSchema.omit({ organizationId: true })
) {}
