/**
 * Disconnect a custom domain.
 *
 * TOMBSTONE, NEVER DELETE. The schema says `removed` is "a tombstone — we never
 * reuse the row", and the reason is the global UNIQUE on `domain`: deleting the
 * row frees the hostname for any other tenant to claim, and a hostname that has
 * pointed at one clinic's site is exactly the one you do not want silently
 * serving another's.
 *
 * IDEMPOTENT. Both halves: the row is already `removed` → success without a
 * second provider call, and `provider.remove` itself treats "already gone" as
 * success. A BullMQ retry after a partial failure therefore converges.
 *
 * The provider call is BEST-EFFORT and deliberately does not fail the service.
 * The tenant's intent is "stop using this domain", and that is satisfied the
 * moment our row stops resolving — `resolveMicrositeHost` only ever matches
 * `active`. A domain left attached at the provider is a cleanup task, not a
 * reason to tell a tenant their disconnect failed.
 */

import { micrositeDomain } from '@borradh-workspace/database';
import { logError, trackedResult } from '@borradh-workspace/observability';
import { and, eq } from 'drizzle-orm';
import {
  type DbConnection,
  ErrorCodes,
  FeatureError,
  type Result,
  err,
  ok,
} from '../../../shared/index.js';
import type { DomainServiceDeps } from '../add-microsite-domain/index.js';
import { domainPairFor, validateMicrositeDomain } from '../domain-name.js';
import {
  type RemoveMicrositeDomainInput,
  removeMicrositeDomainSchema,
} from './remove-microsite-domain.schema.js';

export interface RemoveMicrositeDomainOutput {
  id: string;
  domain: string;
  status: 'removed';
  /** True when the row was already a tombstone — a retry, not an error. */
  alreadyRemoved: boolean;
  /** True when the provider still had it attached and we detached it. */
  detachedAtProvider: boolean;
}

const removeMicrositeDomainImpl = async (
  db: DbConnection,
  input: RemoveMicrositeDomainInput,
  deps: DomainServiceDeps
): Promise<Result<RemoveMicrositeDomainOutput>> => {
  const parsed = removeMicrositeDomainSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  const { domainId, micrositeId, organizationId } = parsed.data;

  // All three ids are predicates. A wrong-org id cannot read the row, so it
  // cannot learn the row exists — NOT_FOUND, never FORBIDDEN.
  const row = await db.query.micrositeDomain.findFirst({
    where: and(
      eq(micrositeDomain.id, domainId),
      eq(micrositeDomain.micrositeId, micrositeId),
      eq(micrositeDomain.organizationId, organizationId)
    ),
    columns: { id: true, domain: true, status: true },
  });

  if (!row) {
    return err(new FeatureError(ErrorCodes.NOT_FOUND, 'Domain not found'));
  }

  if (row.status === 'removed') {
    return ok({
      id: row.id,
      domain: row.domain,
      status: 'removed' as const,
      alreadyRemoved: true,
      detachedAtProvider: false,
    });
  }

  // Detach the pair we provisioned, not just the canonical name — leaving
  // `www.salon.com` attached would keep serving the site on half the hostnames
  // the tenant just disconnected.
  const validated = validateMicrositeDomain(row.domain);
  const pair = validated.valid
    ? domainPairFor(validated.value)
    : { canonical: row.domain, alias: null };

  let detachedAtProvider = false;
  for (const name of [pair.canonical, pair.alias].filter((n): n is string =>
    Boolean(n)
  )) {
    const removed = await deps.provider.remove(name);
    if (removed.success) {
      detachedAtProvider ||= !removed.data.alreadyRemoved;
    } else {
      // Best-effort — see the file header.
      logError('microsites.removeMicrositeDomain.provider', removed.error, {
        feature: 'microsites',
        extra: { micrositeId, domain: name, code: removed.error.code },
      });
    }
  }

  await db
    .update(micrositeDomain)
    .set({
      status: 'removed',
      // A tombstone is never the primary. Leaving the flag set would make
      // "which host do links use?" answer with a domain that no longer resolves.
      isPrimary: false,
      errorMessage: null,
    })
    .where(
      and(
        eq(micrositeDomain.id, domainId),
        eq(micrositeDomain.organizationId, organizationId)
      )
    );

  return ok({
    id: row.id,
    domain: row.domain,
    status: 'removed' as const,
    alreadyRemoved: false,
    detachedAtProvider,
  });
};

export const removeMicrositeDomain = (
  db: DbConnection,
  input: RemoveMicrositeDomainInput,
  deps: DomainServiceDeps
) =>
  trackedResult(
    'microsites.removeMicrositeDomain',
    () => removeMicrositeDomainImpl(db, input, deps),
    {
      properties: {
        domainId: input.domainId,
        micrositeId: input.micrositeId,
        organizationId: input.organizationId,
      },
    }
  );

export type RemoveMicrositeDomainResult = Awaited<
  ReturnType<typeof removeMicrositeDomain>
>;
