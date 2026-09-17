import { db, withSystemScope } from '@borradh-workspace/database';
import { checkMemberAccess } from '@borradh-workspace/features/organizations';
import {
  type CanActivate,
  type ExecutionContext,
  ForbiddenException,
  Injectable,
  Logger,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { SKIP_MEMBER_CHECK_KEY } from '../decorators/skip-member-check.decorator';
import type { AuthenticatedRequest } from './auth.guard';

/**
 * Global guard that checks if the authenticated user is a member of the active organization.
 * Must be registered after AuthGuard (which attaches user and activeOrganizationId to the request).
 *
 * Automatically skips when:
 * - @SkipMemberCheck() decorator is present on the controller or handler
 * - No authenticated user on the request (unauthenticated routes)
 * - No activeOrganizationId on the request (routes without org context)
 */
@Injectable()
export class MemberGuard implements CanActivate {
  private readonly logger = new Logger(MemberGuard.name);

  constructor(private readonly reflector: Reflector) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    // Check @SkipMemberCheck() on handler or controller
    const skipMemberCheck = this.reflector.getAllAndOverride<boolean>(
      SKIP_MEMBER_CHECK_KEY,
      [context.getHandler(), context.getClass()]
    );
    if (skipMemberCheck) return true;

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();

    const userId = request.user?.id;
    const organizationId = request.activeOrganizationId;

    // Skip if no auth context (public routes) or no org context
    if (!userId || !organizationId) return true;

    const result = await withSystemScope(
      (conn) => checkMemberAccess(conn, { userId, organizationId }),
      { db }
    );

    if (!result.success || !result.data.isMember) {
      this.logger.warn(
        `Member access denied for user ${userId} in org ${organizationId}`
      );
      throw new ForbiddenException('You are not a member of this organization');
    }

    return true;
  }
}
