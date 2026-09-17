import { type ExecutionContext, createParamDecorator } from '@nestjs/common';
import type { Request } from 'express';

/**
 * RawCookieHeader Decorator — the caller's whole `Cookie` header, verbatim.
 *
 * Several Better Auth endpoints (verifyTOTP, impersonateUser,
 * stopImpersonating) resolve the session through `getSessionFromCtx` and read
 * companion signed cookies — `two_factor`, `admin_session` — so forwarding just
 * the session token is not enough; the entire header has to go through.
 *
 * ```typescript
 * @Post('impersonate')
 * impersonate(@RawCookieHeader() cookieHeader: string | undefined) { … }
 * ```
 */
export const RawCookieHeader = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext) =>
    ctx.switchToHttp().getRequest<Request>().headers.cookie
);
