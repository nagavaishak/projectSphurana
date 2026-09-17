import { listResourceCategoriesSchema } from '@borradh-workspace/features/resources';
import { queryBoolean } from '@borradh-workspace/features/shared';
import { createZodDto } from 'nestjs-zod';

/**
 * Query for GET /resources/categories.
 *
 * `includeInactive` is re-declared as `queryBoolean()` because the feature
 * schema types it as a real `z.boolean()` — correct for an internal caller,
 * a hard 400 for the one that arrives as the STRING "true" off the wire.
 * Coercion belongs at the transport boundary, which is this file.
 *
 * `z.coerce.boolean()` is NOT the alternative: it is JavaScript truthiness, so
 * `?includeInactive=false` would read as TRUE and the filter would run
 * backwards (see `packages/features/src/shared/query-boolean.ts`).
 */
export class ListResourceCategoriesDto extends createZodDto(
  listResourceCategoriesSchema
    .omit({ organizationId: true, includeInactive: true })
    .extend({ includeInactive: queryBoolean() })
) {}
