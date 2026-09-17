import { organizationLocation } from '@borradh-workspace/database';
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
  type ResolveActiveLocationInput,
  resolveActiveLocationSchema,
} from './resolve-active-location.schema.js';

export interface ResolvedActiveLocation {
  id: string;
  organizationId: string;
  name: string | null;
  isPrimary: boolean;
}

/**
 * Resolve the location a request claims to be scoped to, and prove it belongs
 * to the caller's organization.
 *
 * This is the whole security value of the `X-Location-Id` header: the id
 * arrives from the client, so it is attacker-controlled. Without this check a
 * request authenticated for org A could filter a list by a location belonging
 * to org B — and any endpoint that scopes ONLY by `location_id` (rather than
 * `organization_id AND location_id`) would then read across the tenant
 * boundary. The guard runs this once per request; nothing downstream re-checks.
 *
 * Deliberately NOT wrapped in `trackedResult`: it runs on every authenticated
 * request in a guard, and a per-request PostHog event for "the location header
 * was valid" is noise. The guard logs rejections.
 */
export const resolveActiveLocation = async (
  db: DbConnection,
  input: ResolveActiveLocationInput
): Promise<Result<ResolvedActiveLocation>> => {
  const parsed = resolveActiveLocationSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  const { organizationId, locationId } = parsed.data;

  const location = await db.query.organizationLocation.findFirst({
    where: and(
      eq(organizationLocation.id, locationId),
      eq(organizationLocation.organizationId, organizationId)
    ),
    columns: { id: true, organizationId: true, name: true, isPrimary: true },
  });

  // NOT_FOUND rather than FORBIDDEN on purpose: "this location exists but is
  // not yours" and "this location does not exist" must be indistinguishable,
  // or the endpoint becomes an id oracle for other tenants' branches.
  if (!location) {
    return err(new FeatureError(ErrorCodes.NOT_FOUND, 'Location not found'));
  }

  return ok(location);
};

export type ResolveActiveLocationResult = Awaited<
  ReturnType<typeof resolveActiveLocation>
>;
