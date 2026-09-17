import { getResourceUtilisationSchema } from '@borradh-workspace/features/resources';
import { createZodDto } from 'nestjs-zod';

/**
 * Query for GET /resources/utilisation.
 *
 * `from`/`to` are declared `z.coerce.date()` on the feature schema, which is
 * what makes this derivable at all: every query value arrives as a STRING, and
 * a bare `z.date()` on a whole-object `@Query()` DTO is a hard 400 in
 * production (see `apps/api/src/_integration/query-param-coercion.int-spec.ts`).
 *
 * Coercion to Date is safe in a way `z.coerce.boolean()` is not — an
 * unparseable string yields an Invalid Date, which `z.date()` rejects. The
 * window's own ordering rule (`to` after `from`) lives in the service, so HTTP
 * and internal callers cannot disagree about it.
 */
export class ResourceUtilisationDto extends createZodDto(
  getResourceUtilisationSchema.omit({ organizationId: true })
) {}
