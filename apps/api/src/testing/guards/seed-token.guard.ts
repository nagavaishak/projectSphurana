import { timingSafeEqual } from 'node:crypto';
import { apiEnv } from '@borradh-workspace/env/api';
import {
  type CanActivate,
  type ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request } from 'express';

/**
 * The two access tiers of `/testing/*`, as Guards.
 *
 * These were `TestingController.validateSeedToken` and
 * `.validateDestructiveAccess`, called as the first statement of all 44
 * handlers. Policy is a Guard's job (Gate 5) — and here that is not a
 * tidiness argument: a first-line call is something a newly added route can
 * simply FORGET, and the thing being forgotten is what keeps a
 * token-exfiltration endpoint off a production host. A decorator is visible in
 * the route's own declaration and reviewable at a glance.
 *
 * BEHAVIOUR IS UNCHANGED: same `UnauthorizedException` (401), same messages,
 * same constant-time comparison, same `NODE_ENV === 'production'` block with
 * the same `E2E_DESTRUCTIVE_ALLOWED` escape hatch. The only difference is that
 * the check now runs before the handler is entered rather than as its first
 * line — the endpoints carry no `ValidationPipe`, so nothing else can observe
 * the reorder.
 */

/**
 * Validate the seed token. Used by safe/read-only endpoints that can run
 * anywhere `E2E_SEED_TOKEN` is configured.
 */
export function assertSeedToken(authorization: string | undefined): void {
  const expectedToken = apiEnv.E2E_SEED_TOKEN;

  if (!expectedToken) {
    throw new UnauthorizedException(
      'Testing endpoints not enabled (E2E_SEED_TOKEN not configured)'
    );
  }

  const providedToken = authorization?.replace('Bearer ', '');

  if (!providedToken) {
    throw new UnauthorizedException('Invalid seed token');
  }

  const aBuf = Buffer.from(providedToken);
  const bBuf = Buffer.from(expectedToken);
  if (aBuf.length !== bBuf.length || !timingSafeEqual(aBuf, bBuf)) {
    throw new UnauthorizedException('Invalid seed token');
  }
}

/**
 * Validate seed token AND block in production. Used by destructive endpoints
 * (cleanup, force-verify, delete) and by token/session reads, which are
 * exfiltration vectors.
 *
 * Opt-in escape hatch: PR-preview Fly apps inherit NODE_ENV=production from
 * fly.toml but need destructive endpoints for CI. They set
 * E2E_DESTRUCTIVE_ALLOWED=true; real production deploys leave it unset.
 */
export function assertDestructiveAccess(
  authorization: string | undefined
): void {
  if (apiEnv.NODE_ENV === 'production' && !apiEnv.E2E_DESTRUCTIVE_ALLOWED) {
    throw new UnauthorizedException(
      'Destructive testing endpoints disabled in production'
    );
  }
  assertSeedToken(authorization);
}

function authorizationOf(context: ExecutionContext): string | undefined {
  return context.switchToHttp().getRequest<Request>().headers.authorization;
}

/** Safe tier: a valid `E2E_SEED_TOKEN` bearer token, any environment. */
@Injectable()
export class SeedTokenGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    assertSeedToken(authorizationOf(context));
    return true;
  }
}

/** Destructive tier: safe tier PLUS "not a production host". */
@Injectable()
export class DestructiveTestingGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    assertDestructiveAccess(authorizationOf(context));
    return true;
  }
}
