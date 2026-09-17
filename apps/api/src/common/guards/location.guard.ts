import {
  type CanActivate,
  type ExecutionContext,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import type { AuthenticatedRequest } from './auth.guard';

/** Header the client uses to say which branch it is looking at. */
export const LOCATION_HEADER = 'x-location-id';

/**
 * How long a validated (org, location) pair is trusted without re-querying.
 * A location's ORG never changes — the row is created under one org and
 * cascade-deleted with it — so the only staleness this can produce is a
 * deleted location staying valid for up to a minute. That request then reads
 * zero rows, which is the same answer it would get from a fresh check.
 */
const LOCATION_CACHE_TTL_MS = 60 * 1000;
const validatedLocations = new Map<string, number>();

/**
 * Global guard that resolves the request's active LOCATION.
 *
 * WHY A GUARD AND NOT 96 CONTROLLERS. The location id arrives in a client-set
 * header, so it is attacker-controlled in exactly the way `activeOrganizationId`
 * is not (that one comes from the session). An endpoint that filtered on an
 * unvalidated `location_id` alone would read across the tenant boundary. Doing
 * the ownership check once, here, means no controller can forget it and no new
 * controller has to remember it.
 *
 * ABSENT HEADER IS NOT AN ERROR. `request.activeLocationId` stays `undefined`
 * and every downstream service falls back to its org-wide behaviour — which is
 * exactly today's behaviour. That is what lets the API ship ahead of the
 * frontend: the location switcher (§5.4 of the plan) is deliberately inert
 * until the client starts sending the header, and until then nothing changes.
 *
 * Runs after AuthGuard (needs `activeOrganizationId`) and is registered
 * alongside MemberGuard, whose shape it deliberately copies.
 */
/**
 * Validate the `X-Location-Id` header and publish it as
 * `request.activeLocationId`.
 *
 * Exported as a FUNCTION, not just a guard, because guard ORDER made the guard
 * unreachable: `LocationGuard` is a global `APP_GUARD` while `AuthGuard` is
 * class-level, and NestJS composes `[...global, ...class, ...method]` — so the
 * guard ran before `activeOrganizationId` existed, took its "no org context"
 * early return every time, and `@ActiveLocation()` was `undefined` on every
 * request in production. Branch scoping was inert.
 *
 * Calling this from `AuthGuard`, immediately after the org is known, removes
 * the ordering dependency entirely rather than relying on getting it right.
 */
export async function attachActiveLocation(
  request: AuthenticatedRequest,
  organizationId: string | undefined,
  logger?: Logger
): Promise<void> {
  const header = request.headers[LOCATION_HEADER];
  const locationId = typeof header === 'string' ? header.trim() : '';
  if (!locationId) return;

  // No org context means no tenant to validate against (public/auth routes).
  // Ignore the header rather than 404 — those routes never read it.
  if (!organizationId) return;

  const cacheKey = `${organizationId}:${locationId}`;
  const cachedAt = validatedLocations.get(cacheKey);
  if (cachedAt && Date.now() - cachedAt < LOCATION_CACHE_TTL_MS) {
    request.activeLocationId = locationId;
    return;
  }

  // Imported LAZILY, both of them. A module-level import of the features
  // barrel pulls integrations in with it, and the database barrel pulls ESM-only
  // deps — either chain breaks any jest suite that transitively loads this file,
  // and `auth.guard.spec` began doing exactly that the moment AuthGuard started
  // calling this. Deferring to call time keeps this module's graph empty; Node
  // caches both, so it costs one resolution per process.
  const [{ resolveActiveLocation }, { db, withSystemScope }] =
    await Promise.all([
      import('@borradh-workspace/features/organization-locations'),
      import('@borradh-workspace/database'),
    ]);

  const result = await withSystemScope(
    (conn) => resolveActiveLocation(conn, { organizationId, locationId }),
    { db }
  );

  if (!result.success) {
    logger?.warn(
      `Rejected location header: org=${organizationId} location=${locationId}`
    );
    // 404, not 403 — see the service's note. "Not yours" and "does not
    // exist" must be the same answer.
    throw new NotFoundException('Location not found');
  }

  validatedLocations.set(cacheKey, Date.now());
  request.activeLocationId = result.data.id;
}

/**
 * Kept registered so a route that opts in explicitly still gets the check, and
 * so the behaviour has a single owner. In the global position it is a no-op:
 * `AuthGuard` has not run yet, so `activeOrganizationId` is undefined and this
 * returns immediately — the real call site is `AuthGuard` itself.
 */
@Injectable()
export class LocationGuard implements CanActivate {
  private readonly logger = new Logger(LocationGuard.name);

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    await attachActiveLocation(
      request,
      request.activeOrganizationId,
      this.logger
    );
    return true;
  }
}
