import { authEnv } from '@borradh-workspace/env/auth';
import {
  type CanActivate,
  type ExecutionContext,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
} from '@nestjs/common';
import type { Response } from 'express';
import { useSecureAdminCookie } from '../session/admin-2fa-cookie.js';
import type { AuthenticatedRequest } from './auth.guard';

const ADMIN_2FA_COOKIE = 'admin_2fa_verified';
const ADMIN_2FA_MAX_AGE = 900; // 15 minutes in seconds

/**
 * Guard that checks if the authenticated user is a global platform admin
 * (listed in ADMIN_USER_IDS env var) AND has a valid admin 2FA verification cookie.
 *
 * Must be used after AuthGuard.
 */
@Injectable()
export class GlobalAdminGuard implements CanActivate {
  private readonly logger = new Logger(GlobalAdminGuard.name);

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const response = context.switchToHttp().getResponse<Response>();

    const userId = request.user?.id;
    if (!userId) {
      throw new ForbiddenException('Authentication required');
    }

    // Check if user is in ADMIN_USER_IDS
    const adminUserIds = authEnv.ADMIN_USER_IDS;
    if (!adminUserIds.includes(userId)) {
      this.logger.warn(
        `Global admin access denied for user ${userId} — not in ADMIN_USER_IDS`
      );
      throw new ForbiddenException('Global admin access required');
    }

    // Check for admin 2FA verification cookie
    const cookieValue = request.cookies?.[ADMIN_2FA_COOKIE];
    if (!cookieValue) {
      throw new HttpException(
        {
          message: 'Admin 2FA verification required',
          code: 'ADMIN_2FA_REQUIRED',
        },
        HttpStatus.UNAUTHORIZED
      );
    }

    // Refresh the cookie (sliding window) on every successful admin-terminal
    // request. Attributes MUST match `setAdmin2faCookie` exactly — including
    // `secure`, which is why that decision lives in one exported function
    // rather than being spelled `true` in both places.
    const cookieDomain = authEnv.COOKIE_DOMAIN;
    response.cookie(ADMIN_2FA_COOKIE, cookieValue, {
      httpOnly: true,
      secure: useSecureAdminCookie(),
      sameSite: 'strict',
      maxAge: ADMIN_2FA_MAX_AGE * 1000,
      ...(cookieDomain && { domain: cookieDomain }),
    });

    return true;
  }
}

export { ADMIN_2FA_COOKIE, ADMIN_2FA_MAX_AGE };
