import { updateAdSchema } from '@borradh-workspace/features/meta-ads';
import { createZodDto } from 'nestjs-zod';

export class UpdateAdDto extends createZodDto(
  updateAdSchema.omit({ adId: true, organizationId: true })
) {}
