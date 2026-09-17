import { type ExecutionContext, createParamDecorator } from '@nestjs/common';
import type { AuthenticatedRequest } from '../guards/auth.guard';

/**
 * SessionToken Decorator - Extracts the session token from the request
 *
 * Use with AuthGuard to get the session token in controller methods.
 *
 * Usage:
 * ```typescript
 * @UseGuards(AuthGuard)
 * @Get('session-info')
 * getSessionInfo(@SessionToken() token: string) {
 *   return { token };
 * }
 * ```
 */
export const SessionToken = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext) => {
    const request = ctx.switchToHttp().getRequest<AuthenticatedRequest>();
    return request.sessionToken;
  }
);
