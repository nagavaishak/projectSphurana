/**
 * "Check now" — the status route (contract §2).
 *
 * The backoff plateaus at 15 minutes, which is right for a background sweep
 * and wrong for the person who has just saved the record at their registrar
 * and is staring at the screen. This runs one poll immediately and returns the
 * row.
 *
 * Authorization is a WHERE-clause predicate on (id, micrositeId,
 * organizationId): a domain belonging to another tenant is NOT_FOUND, never
 * FORBIDDEN — FORBIDDEN would confirm the id exists, which is an oracle over
 * every other tenant's domains. The poll itself is the same idempotent,
 * lock-guarded service the sweep calls, so hammering the button cannot double
 * anything.
 */

import { micrositeDomain } from '@borradh-workspace/database';
import type { MicrositeDomain } from '@borradh-workspace/database';
import { trackedResult } from '@borradh-workspace/observability';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import {
  type DbConnection,
  ErrorCodes,
  FeatureError,
  type Result,
  err,
  ok,
} from '../../shared/index.js';
import {
  type VerifyMicrositeDomainDeps,
  verifyMicrositeDomain,
} from './verify-microsite-domain.service.js';

export const checkDomainNowSchema = z.object({
  domainId: z.string().min(1),
  micrositeId: z.string().min(1),
  organizationId: z.string().min(1),
});

export type CheckDomainNowInput = z.infer<typeof checkDomainNowSchema>;

const checkDomainNowImpl = async (
  db: DbConnection,
  input: CheckDomainNowInput,
  deps: VerifyMicrositeDomainDeps
): Promise<Result<MicrositeDomain>> => {
  const parsed = checkDomainNowSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  const scope = and(
    eq(micrositeDomain.id, parsed.data.domainId),
    eq(micrositeDomain.micrositeId, parsed.data.micrositeId),
    eq(micrositeDomain.organizationId, parsed.data.organizationId)
  );

  const owned = await db.query.micrositeDomain.findFirst({ where: scope });
  if (!owned) {
    return err(new FeatureError(ErrorCodes.NOT_FOUND, 'Domain not found'));
  }

  await verifyMicrositeDomain(db, { domainId: parsed.data.domainId }, deps);

  const fresh = await db.query.micrositeDomain.findFirst({ where: scope });
  return ok((fresh ?? owned) as MicrositeDomain);
};

export const checkDomainNow = (
  db: DbConnection,
  input: CheckDomainNowInput,
  deps: VerifyMicrositeDomainDeps
) =>
  trackedResult(
    'microsites.checkDomainNow',
    () => checkDomainNowImpl(db, input, deps),
    {
      properties: {
        domainId: input.domainId,
        organizationId: input.organizationId,
      },
      trackSuccess: false,
    }
  );
