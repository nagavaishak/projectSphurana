import { setCoverPhotoSchema } from '@borradh-workspace/features/venue';
import { createZodDto } from 'nestjs-zod';

export class SetCoverPhotoDto extends createZodDto(
  setCoverPhotoSchema.omit({ organizationId: true })
) {}
