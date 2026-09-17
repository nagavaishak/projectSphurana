import { createResourceSchema } from '@borradh-workspace/features/resources';
import { createZodDto } from 'nestjs-zod';

/** Body for POST /resources. `organizationId` comes from the session. */
export class CreateResourceDto extends createZodDto(
  createResourceSchema.omit({ organizationId: true })
) {}
