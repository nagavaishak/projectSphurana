import { organizationLocation } from '@borradh-workspace/database';
import { and, eq, inArray } from 'drizzle-orm';
import {
  type DbConnection,
  ErrorCodes,
  FeatureError,
  type Result,
  err,
  ok,
} from '../../../shared/index.js';

/**
 * Prove every id in a branch-assignment body belongs to the caller's org.
 *
 * This is the write-side twin of `resolveActiveLocation`, and it exists for
 * the same reason: the ids arrive in a request body, so they are
 * attacker-controlled. Without the check, `PUT /organization-services/:id/
 * locations` would happily write a join row pointing at ANOTHER tenant's
 * branch — and because the read path filters on the join, that row would then
 * surface the service (and its overridden price) inside the other org's
 * catalogue. A cross-tenant WRITE is strictly worse than a cross-tenant read,
 * which is why this is a hard failure rather than a filter-and-continue.
 *
 * Counts rather than compares sets: `inArray` already de-duplicates, so a body
 * repeating one valid id would pass a naive length check. Duplicates are
 * rejected by the caller's unique constraint anyway, but the count here is
 * taken against the DISTINCT ids so the two never disagree.
 */
export const assertLocationsBelongToOrg = async (
  db: DbConnection,
  input: { organizationId: string; locationIds: readonly string[] }
): Promise<Result<void>> => {
  const distinctIds = [...new Set(input.locationIds)];
  if (distinctIds.length === 0) return ok(undefined);

  const owned = await db.query.organizationLocation.findMany({
    where: and(
      inArray(organizationLocation.id, distinctIds),
      eq(organizationLocation.organizationId, input.organizationId)
    ),
    columns: { id: true },
  });

  if (owned.length !== distinctIds.length) {
    // Same reasoning as `resolveActiveLocation`: do not distinguish "does not
    // exist" from "is not yours".
    return err(
      new FeatureError(
        ErrorCodes.VALIDATION_ERROR,
        'One or more locations not found'
      )
    );
  }

  return ok(undefined);
};
