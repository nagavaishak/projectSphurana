import { type ExecutionContext, createParamDecorator } from '@nestjs/common';
import type { Request } from 'express';
import { isMobileClient } from '../session/session-cookie.js';

/**
 * IsMobileClient Decorator — true when the caller sent `X-Client-Type: mobile`.
 *
 * Native clients cannot use the cross-site session cookie, so auth responses
 * hand them the raw token in the body instead. Web clients must never receive
 * it, which is why this is a header opt-in rather than a heuristic.
 *
 * ```typescript
 * @Post('sign-in')
 * signIn(@IsMobileClient() isMobile: boolean) { … }
 * ```
 */
export const IsMobileClient = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext) =>
    isMobileClient(ctx.switchToHttp().getRequest<Request>())
);
