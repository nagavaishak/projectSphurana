import { listAssetsInputSchema } from '@borradh-workspace/features/assets';
import { createZodDto } from 'nestjs-zod';

/**
 * Query params for `GET /assets`. Derived from the feature input schema so the
 * comma-separated `tags` form, the enum vocabularies and the limit/offset
 * defaults are defined ONCE (in the use case), not restated here.
 *
 * `organizationId` comes from the session, never the client.
 */
export class ListAssetsQueryDto extends createZodDto(
  listAssetsInputSchema.omit({ organizationId: true })
) {}
