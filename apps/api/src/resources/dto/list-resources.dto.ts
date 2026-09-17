import { listResourcesSchema } from '@borradh-workspace/features/resources';
import { queryBoolean } from '@borradh-workspace/features/shared';
import { createZodDto } from 'nestjs-zod';

/**
 * Query for GET /resources. See `list-resource-categories.dto.ts` for why
 * `includeInactive` is re-declared here rather than inherited.
 */
export class ListResourcesDto extends createZodDto(
  listResourcesSchema
    .omit({ organizationId: true, includeInactive: true })
    .extend({ includeInactive: queryBoolean() })
) {}
