import { listRevisionsSchema } from '@borradh-workspace/features/microsites';
import { createZodDto } from 'nestjs-zod';

/** `micrositeId` comes from the route, `organizationId` from the session. */
export class ListMicrositeRevisionsDto extends createZodDto(
  listRevisionsSchema.omit({ micrositeId: true, organizationId: true })
) {}
