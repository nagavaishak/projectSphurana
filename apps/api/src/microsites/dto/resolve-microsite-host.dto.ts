import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

/**
 * API-layer schema (see .claude/rules/api/dto.md — inline is the sanctioned
 * shape when validation is transport-specific). Mirrors
 * `resolveMicrositeHostSchema` in the feature package; it is not imported
 * because the query string also has to survive an absent `path`.
 *
 * `path` is what makes the PATH tier work: `resolveMicrositeHost` reads
 * `/sites/{slug}` out of it, so `www.borradh.io/sites/acme` resolves with the
 * marketing apex as its host. That tier must never depend on a
 * `microsite_domain` row or on DNS — it is the fallback the other two tiers
 * fall back TO (plan §9).
 */
const resolveMicrositeHostSchema = z.object({
  /** The visitor's `Host` header. Scheme/port/case/trailing dot are normalised downstream. */
  host: z.string().trim().min(1).max(253),
  /** Request path. Only consulted for the `/sites/{slug}` tier. */
  path: z.string().trim().max(2048).optional(),
});

export class ResolveMicrositeHostDto extends createZodDto(
  resolveMicrositeHostSchema
) {}
