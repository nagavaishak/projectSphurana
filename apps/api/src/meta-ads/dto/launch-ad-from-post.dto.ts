import { launchAdFromPostSchema } from '@borradh-workspace/features/meta-ads';
import { createZodDto } from 'nestjs-zod';

export class LaunchAdFromPostDto extends createZodDto(
  launchAdFromPostSchema.omit({ organizationId: true })
) {}
