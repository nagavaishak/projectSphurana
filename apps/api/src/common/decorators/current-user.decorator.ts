import { type ExecutionContext, createParamDecorator } from '@nestjs/common';
import type { AuthenticatedRequest } from '../guards/auth.guard';

/**
 * CurrentUser Decorator - Extracts the authenticated user from the request
 *
 * Use with AuthGuard to get the current user in controller methods.
 *
 * Usage:
 * ```typescript
 * @UseGuards(AuthGuard)
 * @Get('profile')
 * getProfile(@CurrentUser() user: AuthenticatedRequest['user']) {
 *   return { id: user.id, name: user.name };
 * }
 *
 * // Or get just the user ID
 * @Get('profile')
 * getProfile(@CurrentUser('id') userId: string) {
 *   return { userId };
 * }
 * ```
 */
export const CurrentUser = createParamDecorator(
  (
    data: keyof AuthenticatedRequest['user'] | undefined,
    ctx: ExecutionContext
  ) => {
    const request = ctx.switchToHttp().getRequest<AuthenticatedRequest>();
    const user = request.user;

    // If a specific property is requested, return just that
    if (data) {
      return user?.[data];
    }

    return user;
  }
);
