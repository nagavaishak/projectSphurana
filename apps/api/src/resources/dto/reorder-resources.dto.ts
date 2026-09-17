import { reorderResourcesSchema } from '@borradh-workspace/features/resources';
import { createZodDto } from 'nestjs-zod';

/**
 * Body for PUT /resources/reorder — the complete `{ id, sortOrder }` list.
 *
 * `locationId` is omitted alongside `organizationId`: both are server-injected
 * from validated context, never taken from the body. The header has been
 * checked against the active organization by `LocationGuard`; a body field has
 * been checked against nothing, and `sales.controller.spec.ts` records what
 * trusting one cost.
 */
export class ReorderResourcesDto extends createZodDto(
  reorderResourcesSchema.omit({ organizationId: true, locationId: true })
) {}
