import { createPortalSessionSchema } from '@borradh-workspace/features/billing';
import { createZodDto } from 'nestjs-zod';

export class CreatePortalSessionDto extends createZodDto(
  createPortalSessionSchema.omit({ organizationId: true })
) {}
