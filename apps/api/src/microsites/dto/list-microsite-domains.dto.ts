import { listMicrositeDomainsSchema } from '@borradh-workspace/features/microsites';
import { createZodDto } from 'nestjs-zod';

export class ListMicrositeDomainsDto extends createZodDto(
  listMicrositeDomainsSchema.omit({ micrositeId: true, organizationId: true })
) {}
