import { type ExecutionContext, createParamDecorator } from '@nestjs/common';
import type { Request } from 'express';
import { extractSessionToken } from '../session/session-cookie.js';

/**
 * SessionCookie Decorator — resolves the caller's session token straight off
 * the raw request: `Authorization: Bearer` first, then the secure session
 * cookie.
 *
 * Distinct from `@SessionToken()`, which reads `request.sessionToken` and so
 * only works on routes behind `AuthGuard`. This one works on UNAUTHENTICATED
 * routes — sign-out, `GET /auth/session`, change-password — which is exactly
 * where it is needed, because those routes decide for themselves what an
 * absent token means.
 *
 * ```typescript
 * @Get('session')
 * getSession(@SessionCookie() token: string | undefined) { … }
 * ```
 */
export const SessionCookie = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext) =>
    extractSessionToken(ctx.switchToHttp().getRequest<Request>())
);
