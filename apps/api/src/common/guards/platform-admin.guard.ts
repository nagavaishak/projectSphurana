import { authEnv } from '@borradh-workspace/env/auth';
import {
  type CanActivate,
  type ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import type { AuthenticatedRequest } from './auth.guard';

/**
 * Platform-admin membership, WITHOUT the 2FA gate.
 *
 * `GlobalAdminGuard` is this check plus a valid `admin_2fa_verified` cookie,
 * and that is right for every admin-terminal route but one: the endpoint that
 * MINTS that cookie cannot also require it. That route used to carry the
 * membership check inline in its handler, which is policy living in a
 * controller — the thing Gate 5 exists to prevent.
 *
 * Must run after `AuthGuard`, which resolves `request.user`.
 */
@Injectable()
export class PlatformAdminGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const userId = request.user?.id;

    if (!userId || !authEnv.ADMIN_USER_IDS.includes(userId)) {
      throw new ForbiddenException('Global admin access required');
    }
    return true;
  }
}
