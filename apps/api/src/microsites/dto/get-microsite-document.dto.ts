import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

/**
 * `host` (+ optional `path`) is not decoration — it is how this route learns
 * WHICH ORG is asking. Plan §2.2: on a tenant surface the organization is
 * determined by the host, never by a path segment. `getMicrositeDocument`
 * enforces the org boundary itself (plan §12) and takes an `organizationId`;
 * an anonymous visitor has no session to supply one, so the host resolves it
 * and the `:micrositeId` in the route is then checked against what the host
 * resolved to. A mismatch is a 404, not a render.
 *
 * `published` is the default on purpose: a missing or misspelled `mode` must
 * never leak an agent's mid-edit draft to the public.
 */
const getMicrositeDocumentSchema = z.object({
  host: z.string().trim().min(1).max(253),
  path: z.string().trim().max(2048).optional(),
  mode: z.enum(['published', 'draft']).default('published'),
  /**
   * Signed preview token. The ONLY way `mode=draft` is served publicly — see
   * packages/features/src/microsites/preview-token.ts. It is bound to a single
   * microsite id, and the id checked against it comes from the ROUTE, so a
   * token minted for one tenant cannot be pointed at another's draft.
   */
  token: z.string().trim().min(1).max(512).optional(),
});

export class GetMicrositeDocumentDto extends createZodDto(
  getMicrositeDocumentSchema
) {}
