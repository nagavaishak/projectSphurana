/**
 * Promote a domain to primary AND run everything that owes (contract §4).
 *
 * `setPrimaryDomain` (../domains) does the database half: one canonical row per
 * site, in a transaction. It deliberately stops there. But a primary change is
 * a HOST change whichever way it was triggered — the verification poller
 * flipping the first custom domain, or an owner picking a different one in the
 * UI — and §4's three effects are owed either way.
 *
 * If the UI path skipped them, the ad rewrite and the Meta re-verification
 * would be a runbook step for exactly the case a human took manually. A manual
 * step here is a step that does not happen. So both entry points converge on
 * the same `domain_changed` enqueue, with the same deterministic job id, which
 * is also what makes the two paths safe to race.
 */

import { microsite } from '@borradh-workspace/database';
import { trackedResult } from '@borradh-workspace/observability';
import { eq } from 'drizzle-orm';
import { type DbConnection, type Result, err, ok } from '../../shared/index.js';
import { micrositeBaseDomains } from '../domains/index.js';
import {
  type SetPrimaryDomainInput,
  setPrimaryDomain,
} from '../domains/set-primary-domain/index.js';
import { toFeatureError } from '../services/shared/errors.js';
import { enqueueDomainChanged } from './domain-queue.js';

export interface ChangePrimaryDomainOutput {
  id: string;
  micrositeId: string;
  domain: string;
  previousPrimaryDomain: string | null;
  /** Whether the §4 fan-out was enqueued for this change. */
  domainChangedEnqueued: boolean;
}

export interface ChangePrimaryDomainDeps {
  enqueue?: typeof enqueueDomainChanged;
}

/** The apex the free `{slug}.<apex>` address lives on — one definition, shared. */
const firstBaseDomain = (): string => micrositeBaseDomains()[0] ?? 'borradh.io';

const changePrimaryDomainImpl = async (
  db: DbConnection,
  input: SetPrimaryDomainInput,
  deps: ChangePrimaryDomainDeps
): Promise<Result<ChangePrimaryDomainOutput>> => {
  const promoted = await setPrimaryDomain(db, input);
  if (!promoted.success) return err(toFeatureError(promoted.error));

  const site = await db.query.microsite.findFirst({
    where: eq(microsite.id, promoted.data.micrositeId),
    columns: { slug: true },
  });

  // No previous custom primary still means the host changed: the site was on
  // its `{slug}.borradh.io` address, which every existing ad points at.
  const previousHost =
    promoted.data.previousPrimaryDomain ??
    `${site?.slug ?? ''}.${firstBaseDomain()}`;

  const changed = previousHost !== promoted.data.domain;
  if (changed) {
    await (deps.enqueue ?? enqueueDomainChanged)({
      micrositeId: promoted.data.micrositeId,
      organizationId: input.organizationId,
      domainId: promoted.data.id,
      previousHost,
      newHost: promoted.data.domain,
    });
  }

  return ok({
    id: promoted.data.id,
    micrositeId: promoted.data.micrositeId,
    domain: promoted.data.domain,
    previousPrimaryDomain: promoted.data.previousPrimaryDomain,
    domainChangedEnqueued: changed,
  });
};

export const changePrimaryDomain = (
  db: DbConnection,
  input: SetPrimaryDomainInput,
  deps: ChangePrimaryDomainDeps = {}
) =>
  trackedResult(
    'microsites.changePrimaryDomain',
    () => changePrimaryDomainImpl(db, input, deps),
    {
      properties: {
        domainId: input.domainId,
        organizationId: input.organizationId,
      },
    }
  );
