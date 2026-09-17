/**
 * `provisionMicrosite` — the site a tenant gets for free at the end of
 * onboarding (plan §8). Queued from `completeOnboardingSession`, never inline:
 * it makes a model call and publishes a website, and must not be able to block
 * or fail the completion response.
 *
 * ORDER OF OPERATIONS, and why:
 *   1. Gather org context — degrades to org name alone if the org has no
 *      location yet.
 *   2. Seed the theme via `seedMicrositeTheme`. Brand colour is NOT re-derived
 *      here; that service already encodes the precedence the graphics pipeline
 *      settled on and the reason `organization.primaryColor` cannot be trusted.
 *   3. ONE model call for copy — with explicit `observability`, because a
 *      BullMQ job has no ambient request context to attribute from.
 *   4. Compose Home/About/Services/Contact from data-bound blocks.
 *   5. Create, then publish revision 1.
 *
 * THE LLM IS NOT ALLOWED TO BREAK THIS. Step 3 falls back to copy derived from
 * the org's own row on every failure mode, and if model copy somehow fails
 * block validation in step 4 the composition is retried on the fallback copy
 * before giving up. A tenant with a plain site beats a tenant with no site.
 */

import type { Database } from '@borradh-workspace/database';
import { createLogger, trackedResult } from '@borradh-workspace/observability';
import {
  ErrorCodes,
  FeatureError,
  type Result,
  err,
  ok,
} from '../../../shared/index.js';
import { bustMicrositeHostCacheForMicrosite } from '../microsite-host-cache/index.js';
import { seedMicrositeTheme } from '../seed-microsite-theme/seed-microsite-theme.service.js';
// Imported from the DEFINING module rather than its barrel so tests can drive
// it with a restored `vi.spyOn` (the features suite runs `isolate: false`, so
// `vi.mock` on an internal module leaks across files).
import { toFeatureError } from '../shared/index.js';
import { composeDefaultPages } from './compose-pages.js';
import {
  createMicrositeForProvisioning,
  publishMicrositeForProvisioning,
  writeMicrositePages,
} from './microsite-writer.js';
import { gatherOrgContext } from './provision-context.js';
import { fallbackCopy, generateMicrositeCopy } from './provision-copy.js';
import {
  type ProvisionMicrositeInput,
  provisionMicrositeSchema,
} from './provision-microsite.schema.js';

const logger = createLogger('ProvisionMicrosite');

export interface ProvisionMicrositeOutput {
  micrositeId: string;
  /** False means the site exists as a draft but revision 1 did not go live. */
  published: boolean;
}

const provisionMicrositeImpl = async (
  db: Database,
  input: ProvisionMicrositeInput
): Promise<Result<ProvisionMicrositeOutput>> => {
  const parsed = provisionMicrositeSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  const { organizationId } = parsed.data;

  const context = await gatherOrgContext(db, organizationId);
  if (!context.success) return err(context.error);

  const theme = await seedMicrositeTheme(db, { organizationId });
  if (!theme.success) return err(toFeatureError(theme.error));

  const copy = await generateMicrositeCopy(context.data);

  let pages = composeDefaultPages(context.data, copy.copy);
  if (!pages.success && copy.source === 'model') {
    // Model copy that cannot pass the block schemas is model copy we throw
    // away — not a failed provisioning run.
    logger.warn('Model copy failed block validation; recomposing on fallback', {
      event: 'microsites.copy_rejected',
      organizationId,
      reason: pages.error.message,
    });
    pages = composeDefaultPages(context.data, fallbackCopy(context.data));
  }
  if (!pages.success) return err(pages.error);

  const created = await createMicrositeForProvisioning(db, {
    organizationId,
    organizationSlug: context.data.organizationSlug,
    theme: theme.data,
  });
  if (!created.success) return err(created.error);

  const micrositeId = created.data.id;

  // IDEMPOTENCY. This job is queued and BullMQ retries, so a second run is
  // normal. `createMicrosite` returns the existing site rather than a new one;
  // if that site is already LIVE, provisioning has already happened and
  // re-composing would overwrite whatever the owner or the agent has since
  // written into it. Stop.
  if (!created.data.created && created.data.publishedRevisionId) {
    logger.info('Microsite already provisioned; leaving it alone', {
      event: 'microsites.provision_skipped',
      organizationId,
      micrositeId,
    });
    return ok({ micrositeId, published: true });
  }

  const written = await writeMicrositePages(db, {
    micrositeId,
    organizationId,
    pages: pages.data,
  });
  if (!written.success) return err(written.error);

  const published = await publishMicrositeForProvisioning(db, {
    micrositeId,
    organizationId,
    label: 'Initial site',
  });

  if (!published.success) {
    // The draft exists and is one publish away from live; erroring out here
    // would throw that away for nothing.
    logger.error('Microsite created but revision 1 was not published', {
      event: 'microsites.provision_publish_failed',
      organizationId,
      micrositeId,
      reason: published.error.message,
    });
    return ok({ micrositeId, published: false });
  }

  // A cached MISS outlives creation otherwise. Anything that asked for
  // /sites/{slug} before now — a crawler, an impatient owner, an e2e run —
  // cached "no such site", and the site they then create 404s until the TTL
  // lapses. Nothing called this bust before; it existed and sat unused.
  await bustMicrositeHostCacheForMicrosite(db, {
    micrositeId,
    slug: created.data.slug,
  });

  logger.info('Microsite provisioned', {
    event: 'microsites.provisioned',
    organizationId,
    micrositeId,
    copySource: copy.source,
    pageCount: pages.data.length,
  });

  return ok({ micrositeId, published: true });
};

export const provisionMicrosite = (
  db: Database,
  input: ProvisionMicrositeInput
) =>
  trackedResult(
    'microsites.provisionMicrosite',
    () => provisionMicrositeImpl(db, input),
    { properties: { organizationId: input.organizationId } }
  );

export type ProvisionMicrositeResult = Awaited<
  ReturnType<typeof provisionMicrosite>
>;
