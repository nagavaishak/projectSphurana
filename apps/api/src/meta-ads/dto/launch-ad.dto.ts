import { launchAdSchema } from '@borradh-workspace/features/meta-ads';
import { createZodDto } from 'nestjs-zod';

export class LaunchAdDto extends createZodDto(
  launchAdSchema.omit({ organizationId: true })
) {}
