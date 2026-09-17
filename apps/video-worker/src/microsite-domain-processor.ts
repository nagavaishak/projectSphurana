/**
 * microsite-domain worker — custom-domain verification polling and the
 * `domain_changed` fan-out.
 *
 * Why this exists at all: without a worker the poller is DORMANT. Jobs enqueue
 * successfully and never run, so a tenant who adds their domain sits on
 * "pending DNS" forever while everything reports healthy. The job-registry gate
 * catches exactly this ("a producer and NO worker anywhere"), which is how this
 * file came to be written.
 *
 * What it does per tick: asks the DomainProvider whether a domain is verified
 * AND correctly routed (two different facts — see the Vercel adapter), and on
 * activation runs the domain_changed flow: bust the host cache for both hosts,
 * rewrite `destination_url` on live ads, and trigger Meta re-verification.
 *
 * SYSTEM scope: a cross-org worker path, like meta-sync. It never holds a DB
 * connection across the provider's network calls.
 *
 * Producer: `packages/features/src/microsites/domain-verification`.
 */

import { db } from '@borradh-workspace/database';
import {
  MICROSITE_DOMAIN_QUEUE,
  type MicrositeDomainJob,
  ensureMicrositeDomainSweepSchedule,
  processMicrositeDomainJob,
} from '@borradh-workspace/features/microsites/domain-verification';
import { createVercelDomainProvider } from '@borradh-workspace/integrations/domains';
import { createLogger } from '@borradh-workspace/observability';
import { getRedis } from '@borradh-workspace/redis';
import { Worker } from 'bullmq';

/**
 * Deliberately low. Each job is mostly waiting on the provider's API, and DNS
 * propagation is measured in minutes — there is nothing to gain from
 * parallelism here, and a domain provider is exactly the kind of API that rate
 * limits.
 */
const MICROSITE_DOMAIN_CONCURRENCY = 2;

export function createMicrositeDomainWorker(): Worker<MicrositeDomainJob> {
  const log = createLogger('microsite-domain');
  const connection = getRedis();
  const provider = createVercelDomainProvider();

  log.info(
    `Starting microsite-domain worker with concurrency: ${MICROSITE_DOMAIN_CONCURRENCY}`
  );

  const worker = new Worker<MicrositeDomainJob>(
    MICROSITE_DOMAIN_QUEUE,
    async (job) => processMicrositeDomainJob(db, job.data, { provider }),
    { connection, concurrency: MICROSITE_DOMAIN_CONCURRENCY }
  );

  worker.on('failed', (job, error) => {
    // A failed poll is normal (DNS not propagated yet) and the service decides
    // when to give up. Log at warn so a transient provider blip does not read
    // as an incident.
    log.warn(
      `microsite-domain job ${job?.id ?? 'unknown'} failed: ${error.message}`
    );
  });

  // The repeatable sweep is what finds domains whose individual job was lost to
  // a queue flush. Without it a redeploy could strand a tenant mid-verification.
  void ensureMicrositeDomainSweepSchedule().catch((error: unknown) => {
    log.error(
      `Could not schedule the microsite-domain sweep: ${
        error instanceof Error ? error.message : String(error)
      }`
    );
  });

  return worker;
}

export async function closeMicrositeDomainWorker(
  worker: Worker<MicrositeDomainJob>
): Promise<void> {
  await worker.close();
}
