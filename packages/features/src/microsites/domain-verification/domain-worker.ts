/**
 * The processor half of the queue. Kept apart from `domain-queue.ts` so the
 * producer (imported by the verification service) and the consumer (which
 * imports it) do not form a cycle.
 *
 * The host app owns the `Worker` instance; this exports the one function it
 * runs, so the routing lives beside the jobs rather than in the app.
 */

import { logError } from '@borradh-workspace/observability';
import type { DbConnection } from '../../shared/index.js';
import {
  DOMAIN_CHANGED_JOB,
  VERIFY_SWEEP_JOB,
} from './domain-verification.constants.js';
import {
  domainChangedJobSchema,
  verifySweepJobSchema,
} from './domain-verification.schema.js';
import { handleDomainChanged } from './handle-domain-changed.service.js';
import { sweepDomainVerifications } from './sweep-domain-verifications.service.js';
import type { VerifyMicrositeDomainDeps } from './verify-microsite-domain.service.js';

export interface MicrositeDomainJob {
  name: string;
  data: unknown;
}

/**
 * Route one job. Returns `false` for a name it does not own so an unknown job
 * is visible rather than silently completed.
 */
export const processMicrositeDomainJob = async (
  db: DbConnection,
  job: MicrositeDomainJob,
  deps: VerifyMicrositeDomainDeps
): Promise<boolean> => {
  if (job.name === VERIFY_SWEEP_JOB) {
    const parsed = verifySweepJobSchema.safeParse(job.data ?? {});
    await sweepDomainVerifications(db, {
      ...deps,
      limit: parsed.success ? parsed.data.limit : undefined,
    });
    return true;
  }

  if (job.name === DOMAIN_CHANGED_JOB) {
    const parsed = domainChangedJobSchema.safeParse(job.data);
    if (!parsed.success) {
      logError(
        'microsites.processDomainChangedJob',
        new Error('Invalid domain_changed job payload'),
        { feature: 'microsites', extra: { issues: parsed.error.issues } }
      );
      return true;
    }
    await handleDomainChanged(db, parsed.data);
    return true;
  }

  return false;
};
