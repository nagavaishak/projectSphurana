import {
  type CanActivate,
  type ExecutionContext,
  HttpException,
  HttpStatus,
  Injectable,
} from '@nestjs/common';
import type { Request } from 'express';

import { assertSeedToken } from '../../testing/guards/index.js';

/**
 * Strict boolean env read. Only "true" and "1" enable; everything else — including
 * the string "false" — disables.
 *
 * Deliberately NOT `apiEnv.*`, whose booleans are declared `z.coerce.boolean()`.
 * That is `Boolean(string)`, so ANY non-empty value is true: `"false"` parses as
 * TRUE, and so does `"0"`. Verified against the repo's own zod.
 *
 * For a flag whose whole job is "is this a real production host", a value that
 * reads as off but evaluates as on is not a style problem. Someone writing
 * E2E_DESTRUCTIVE_ALLOWED="false" on production — the intuitive way to say no —
 * would open destructive testing endpoints there. This guard refuses to inherit
 * that. The shared declarations want fixing too, but not from inside a security
 * guard's PR.
 */
const enabled = (name: string): boolean => {
  const raw = process.env[name]?.trim().toLowerCase();
  return raw === 'true' || raw === '1';
};

/**
 * Gate the `/debug/*` controller, whose entire purpose is to inject errors.
 *
 * Class-level `@UseGuards` on purpose: a per-handler first-line check is one a
 * newly added route can silently omit.
 *
 * FOUR TIERS. The shape is unusual because two requirements pull against each
 * other, and both are legitimate:
 *
 *   - These routes emit into the same error stream on-call trusts. A synthetic
 *     exception that reaches Sentry looks exactly like a customer failure —
 *     which happened (API-FE, MARKETING-4), and is why they must be off unless
 *     someone deliberately turned them on.
 *   - Preview is the only deployed place the error pipeline can be PROVEN. That
 *     verification found three separate silent breakages on 2026-08-17:
 *     logWarning reaching Sentry but not PostHog, marketing SSR reaching
 *     neither, and an `await` that never awaited delivery. Removing the routes
 *     from every deployment would have left all three undiscovered.
 *
 * So: fail closed everywhere by default, stay impossible on real production, and
 * require BOTH an explicit flag and an authenticated token to work on preview.
 *
 *   1. `DEBUG_ENDPOINTS_ENABLED` unset/false          → 404, everywhere, always.
 *   2. real production (flag or not)                  → 404. Not expressible.
 *   3. preview/staging + flag + `E2E_SEED_TOKEN`      → allowed, token REQUIRED.
 *   4. local dev/test + flag                          → allowed.
 *
 * The 404 (rather than 403) is the contract: where these are unavailable they
 * must look like they do not exist.
 *
 * NOTE ON "production": PR-preview and staging Fly apps inherit
 * `NODE_ENV=production` from fly.toml, so NODE_ENV alone cannot distinguish a
 * preview host from a real one. `E2E_DESTRUCTIVE_ALLOWED` is the existing flag
 * that does — the testing controller hit this same wall first.
 */
@Injectable()
export class NonProductionGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    // 1. Not enabled anywhere unless explicitly asked for. This is the tier the
    //    incident review asked for: "on because nobody set anything" is wrong
    //    for routes that manufacture errors.
    if (!enabled('DEBUG_ENDPOINTS_ENABLED')) {
      throw new HttpException('Not Found', HttpStatus.NOT_FOUND);
    }

    const isDeployedProductionShaped = process.env.NODE_ENV === 'production';

    // 2. Real production: no flag combination reaches these routes.
    if (isDeployedProductionShaped && !enabled('E2E_DESTRUCTIVE_ALLOWED')) {
      throw new HttpException('Not Found', HttpStatus.NOT_FOUND);
    }

    // 3. Preview/staging: reachable, but only with the seed token. Throws 401 on
    //    a missing or wrong token, and also when no token is configured at all —
    //    a host that sets the flags but forgets the token fails closed.
    if (isDeployedProductionShaped) {
      const request = context.switchToHttp().getRequest<Request>();
      assertSeedToken(request.headers.authorization);
    }

    // 4. Local dev/test, flag already checked above.
    return true;
  }
}
