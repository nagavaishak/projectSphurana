/**
 * The tenant's domains for one microsite.
 *
 * Authorization is the WHERE clause, not a post-fetch comparison: BOTH
 * `micrositeId` AND `organizationId` are predicates, so a cross-org id returns
 * an empty list rather than another tenant's hostnames. `verification` is
 * returned because the settings UI needs the records to display — it contains
 * DNS challenges the tenant is meant to see, and nothing secret.
 */

import { micrositeDomain } from '@borradh-workspace/database';
import type { MicrositeDomain } from '@borradh-workspace/database';
import { trackedResult } from '@borradh-workspace/observability';
import { and, desc, eq, ne } from 'drizzle-orm';
import {
  type DbConnection,
  ErrorCodes,
  FeatureError,
  type Result,
  err,
  ok,
} from '../../../shared/index.js';
import {
  type ListMicrositeDomainsInput,
  listMicrositeDomainsSchema,
} from './list-microsite-domains.schema.js';

export interface ListMicrositeDomainsOutput {
  items: MicrositeDomain[];
  /** The domain marketing and ad destinations should point at, if any. */
  primaryDomain: string | null;
}

const listMicrositeDomainsImpl = async (
  db: DbConnection,
  input: ListMicrositeDomainsInput
): Promise<Result<ListMicrositeDomainsOutput>> => {
  const parsed = listMicrositeDomainsSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  const { micrositeId, organizationId, includeRemoved } = parsed.data;

  const scope = and(
    eq(micrositeDomain.micrositeId, micrositeId),
    eq(micrositeDomain.organizationId, organizationId)
  );

  const items = (await db.query.micrositeDomain.findMany({
    where: includeRemoved
      ? scope
      : and(scope, ne(micrositeDomain.status, 'removed')),
    orderBy: [desc(micrositeDomain.isPrimary), desc(micrositeDomain.createdAt)],
  })) as MicrositeDomain[];

  const primary = items.find(
    (item) => item.isPrimary && item.status === 'active'
  );

  return ok({ items, primaryDomain: primary?.domain ?? null });
};

export const listMicrositeDomains = (
  db: DbConnection,
  input: ListMicrositeDomainsInput
) =>
  trackedResult(
    'microsites.listMicrositeDomains',
    () => listMicrositeDomainsImpl(db, input),
    {
      properties: {
        micrositeId: input.micrositeId,
        organizationId: input.organizationId,
      },
      trackSuccess: false,
    }
  );

export type ListMicrositeDomainsResult = Awaited<
  ReturnType<typeof listMicrositeDomains>
>;
