/**
 * Choose the canonical host for a microsite.
 *
 * "Pick a canonical and keep it — it matters for the pixel and for ad
 * destination URLs" (plan §2.1). This flag is what every link builder, every
 * ad `destination_url` and every Meta domain verification reads, so exactly one
 * row per site may carry it. The clear-then-set runs in ONE transaction: split
 * them and a crash in between leaves a site with two primaries (links pick one
 * at random) or none (links silently fall back to our apex, which is the exact
 * failure the custom-domain feature exists to prevent).
 *
 * ONLY an `active` domain may be primary. Promoting a `pending_dns` row would
 * point every booking link at a hostname with no DNS and no certificate — a
 * self-inflicted outage on the tenant's own marketing, and one that looks like
 * our bug rather than their DNS.
 */

import type { Database } from '@borradh-workspace/database';
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
import {
  type SetPrimaryDomainInput,
  setPrimaryDomainSchema,
} from './set-primary-domain.schema.js';

export interface SetPrimaryDomainOutput {
  id: string;
  micrositeId: string;
  domain: string;
  isPrimary: true;
  /** The host that was canonical before, or null on the first promotion. */
  previousPrimaryDomain: string | null;
}

/** Carries a FeatureError out of the transaction callback so it rolls back. */
class PrimaryAbort extends Error {
  constructor(readonly featureError: FeatureError) {
    super(featureError.message);
  }
}

const setPrimaryDomainImpl = async (
  db: DbConnection,
  input: SetPrimaryDomainInput
): Promise<Result<SetPrimaryDomainOutput>> => {
  const parsed = setPrimaryDomainSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  const { domainId, micrositeId, organizationId } = parsed.data;

  try {
    const result = await (db as Database).transaction(async (tx) => {
      const target = await tx.query.micrositeDomain.findFirst({
        where: and(
          eq(micrositeDomain.id, domainId),
          eq(micrositeDomain.micrositeId, micrositeId),
          eq(micrositeDomain.organizationId, organizationId)
        ),
        columns: { id: true, domain: true, status: true, isPrimary: true },
      });

      if (!target) {
        throw new PrimaryAbort(
          new FeatureError(ErrorCodes.NOT_FOUND, 'Domain not found')
        );
      }

      if (target.status !== 'active') {
        throw new PrimaryAbort(
          new FeatureError(
            ErrorCodes.CONFLICT,
            'That domain is not live yet — it can become your main address once DNS has verified',
            { status: target.status }
          )
        );
      }

      const previous = await tx.query.micrositeDomain.findFirst({
        where: and(
          eq(micrositeDomain.micrositeId, micrositeId),
          eq(micrositeDomain.organizationId, organizationId),
          eq(micrositeDomain.isPrimary, true)
        ),
        columns: { id: true, domain: true },
      });

      await tx
        .update(micrositeDomain)
        .set({ isPrimary: false })
        .where(
          and(
            eq(micrositeDomain.micrositeId, micrositeId),
            eq(micrositeDomain.organizationId, organizationId),
            eq(micrositeDomain.isPrimary, true)
          )
        );

      await tx
        .update(micrositeDomain)
        .set({ isPrimary: true })
        .where(
          and(
            eq(micrositeDomain.id, domainId),
            eq(micrositeDomain.organizationId, organizationId)
          )
        );

      return {
        id: target.id,
        domain: target.domain,
        previousPrimaryDomain:
          previous && previous.id !== target.id ? previous.domain : null,
      };
    });

    return ok({
      id: result.id,
      micrositeId,
      domain: result.domain,
      isPrimary: true as const,
      previousPrimaryDomain: result.previousPrimaryDomain,
    });
  } catch (error) {
    if (error instanceof PrimaryAbort) return err(error.featureError);

    logError('microsites.setPrimaryDomain', error, {
      feature: 'microsites',
      extra: { domainId, micrositeId, organizationId },
    });
    return err(
      new FeatureError(
        ErrorCodes.INTERNAL_ERROR,
        'Failed to set primary domain'
      )
    );
  }
};

export const setPrimaryDomain = (
  db: DbConnection,
  input: SetPrimaryDomainInput
) =>
  trackedResult(
    'microsites.setPrimaryDomain',
    () => setPrimaryDomainImpl(db, input),
    {
      properties: {
        domainId: input.domainId,
        micrositeId: input.micrositeId,
        organizationId: input.organizationId,
      },
    }
  );

export type SetPrimaryDomainResult = Awaited<
  ReturnType<typeof setPrimaryDomain>
>;
