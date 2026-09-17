/**
 * The ONLY file that binds provisioning to the sibling persistence services.
 *
 * `createMicrosite` and `publishMicrosite` are owned by another service
 * directory. Everything provisioning needs from them is funnelled through the
 * adapters below, so a signature change there is contained here rather than
 * spreading through the service, the composition and their tests.
 *
 * It also owns the one thing neither sibling does: turning an org slug into a
 * legal HOSTNAME LABEL. `micrositeSlugSchema` is stricter than
 * `organization.slug` (DNS label rules, plus a reserved-label deny list), so a
 * perfectly valid org slug can be an illegal subdomain — and provisioning is
 * the caller that has to pick one unattended.
 */

import type { Database } from '@borradh-workspace/database';
import type { MicrositeTheme } from '@borradh-workspace/web-shared';
import { ErrorCodes, type Result, err } from '../../../shared/index.js';
import { micrositeSlugSchema } from '../create-microsite/create-microsite.schema.js';
// Imported from the DEFINING module rather than its barrel so tests can drive
// it with a restored `vi.spyOn` (the features suite runs `isolate: false`, so
// `vi.mock` on an internal module leaks across files).
import {
  type CreateMicrositeOutput,
  createMicrosite,
} from '../create-microsite/create-microsite.service.js';
import { publishMicrosite } from '../publish-microsite/publish-microsite.service.js';
// `trackedResult` widens a service's error to a plain object, so a tracked
// service cannot forward another tracked service's error unchanged.
import { toFeatureError } from '../shared/index.js';
import { writeComposedPages } from './write-page-blocks.js';

/**
 * A DNS-safe, non-reserved slug for this org.
 *
 * The org slug is tried first — it is what the tenant already knows themselves
 * as. When it is illegal or reserved (`app`, `portal`, `www`, …) a
 * DETERMINISTIC suffix from the org id is added rather than a random one, so a
 * BullMQ retry that gets past the idempotency check computes the same slug
 * instead of minting a second address.
 */
export function micrositeSlugFor(
  organizationSlug: string,
  organizationId: string
): string {
  const base = organizationSlug
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 50)
    .replace(/-+$/g, '');

  const direct = micrositeSlugSchema.safeParse(base);
  if (direct.success) return direct.data;

  return suffixedSlug(base, organizationId);
}

/** The second candidate: used for a reserved/illegal slug AND for a collision. */
export function suffixedSlug(base: string, organizationId: string): string {
  const suffix =
    organizationId
      .replace(/[^a-z0-9]/gi, '')
      .toLowerCase()
      .slice(-6) || 'site';
  const candidate = `${base || 'site'}-${suffix}`;
  const parsed = micrositeSlugSchema.safeParse(candidate);
  return parsed.success ? parsed.data : `site-${suffix}`;
}

/**
 * Create the microsite, retrying ONCE on a slug already held by another org.
 * `createMicrosite` is idempotent per org, so a retry of the whole job returns
 * the existing site rather than colliding with itself.
 */
export const createMicrositeForProvisioning = async (
  db: Database,
  input: {
    organizationId: string;
    organizationSlug: string;
    theme: MicrositeTheme;
  }
): Promise<Result<CreateMicrositeOutput>> => {
  const { organizationId, organizationSlug, theme } = input;
  const slug = micrositeSlugFor(organizationSlug, organizationId);

  const first = await createMicrosite(db, { organizationId, slug, theme });
  if (first.success) return first;
  if (first.error.code !== ErrorCodes.ALREADY_EXISTS) {
    return err(toFeatureError(first.error));
  }

  const retry = await createMicrosite(db, {
    organizationId,
    slug: suffixedSlug(slug, organizationId),
    theme,
  });
  return retry.success ? retry : err(toFeatureError(retry.error));
};

export const writeMicrositePages = writeComposedPages;

export const publishMicrositeForProvisioning = (
  db: Database,
  input: { micrositeId: string; organizationId: string; label: string }
) => publishMicrosite(db, { ...input, createdBy: 'system' as const });
