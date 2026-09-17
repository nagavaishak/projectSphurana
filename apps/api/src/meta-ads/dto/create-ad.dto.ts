import { createAdSchema } from '@borradh-workspace/features/meta-ads';
import { createZodDto } from 'nestjs-zod';

export class CreateAdDto extends createZodDto(
  createAdSchema.omit({ organizationId: true })
) {}
