/**
 * One tick of the repeatable job: find the domains that are DUE and verify
 * each one.
 *
 * A sweep rather than a per-domain delayed job because the pacing then lives in
 * one pure function (`backoff.ts`) that a test can read, instead of in a tree
 * of scheduled BullMQ jobs whose real delays are only visible in Redis. It also
 * self-heals: a domain whose job was lost to a queue flush is picked up on the
 * next tick, because "due" is computed from the row, not from a job existing.
 */

import { micrositeDomain } from '@borradh-workspace/database';
import { createLogger, trackedResult } from '@borradh-workspace/observability';
import { inArray } from 'drizzle-orm';
import { type DbConnection, type Result, ok } from '../../shared/index.js';
import { isDueForVerification } from './backoff.js';
import { SWEEP_BATCH_LIMIT } from './domain-verification.constants.js';
import {
  type VerifyMicrositeDomainDeps,
  verifyMicrositeDomain,
} from './verify-microsite-domain.service.js';

const logger = createLogger('MicrositeDomainSweep');

export interface SweepOutput {
  candidates: number;
  due: number;
  activated: number;
  gaveUp: number;
  pending: number;
  skipped: number;
}

const sweepImpl = async (
  db: DbConnection,
  deps: VerifyMicrositeDomainDeps & { limit?: number }
): Promise<Result<SweepOutput>> => {
  const now = deps.now ?? new Date();

  const candidates = await db.query.micrositeDomain.findMany({
    where: inArray(micrositeDomain.status, ['pending_dns', 'verifying']),
    limit: deps.limit ?? SWEEP_BATCH_LIMIT,
    columns: { id: true, createdAt: true, lastCheckedAt: true },
  });

  const out: SweepOutput = {
    candidates: candidates.length,
    due: 0,
    activated: 0,
    gaveUp: 0,
    pending: 0,
    skipped: 0,
  };

  for (const row of candidates) {
    if (
      !isDueForVerification({
        createdAt: new Date(row.createdAt),
        lastCheckedAt: row.lastCheckedAt ? new Date(row.lastCheckedAt) : null,
        now,
      })
    ) {
      continue;
    }
    out.due += 1;

    // Per-domain, not all-or-nothing: one provider timeout must not stop the
    // sweep from reaching the other 199 tenants.
    const result = await verifyMicrositeDomain(db, { domainId: row.id }, deps);
    if (!result.success) {
      out.skipped += 1;
      continue;
    }
    if (result.data.outcome === 'activated') out.activated += 1;
    else if (result.data.outcome === 'gave_up') out.gaveUp += 1;
    else if (result.data.outcome === 'pending') out.pending += 1;
    else out.skipped += 1;
  }

  if (out.due > 0)
    logger.info('Microsite domain verification sweep', { ...out });

  return ok(out);
};

export const sweepDomainVerifications = (
  db: DbConnection,
  deps: VerifyMicrositeDomainDeps & { limit?: number }
) =>
  trackedResult('microsites.sweepDomainVerifications', () =>
    sweepImpl(db, deps)
  );
