import { db, withSystemScope } from '@borradh-workspace/database';
import { checkAdminAccess } from '@borradh-workspace/features/organizations';
import {
  type CanActivate,
  type ExecutionContext,
  ForbiddenException,
  Injectable,
  Logger,
} from '@nestjs/common';
import type { AuthenticatedRequest } from './auth.guard';

/**
 * Guard that checks if the authenticated user has admin or owner role
 * in the active organization. Must be used after AuthGuard.
 */
@Injectable()
export class AdminGuard implements CanActivate {
  private readonly logger = new Logger(AdminGuard.name);

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();

    const userId = request.user?.id;
    const organizationId = request.activeOrganizationId;

    if (!userId || !organizationId) {
      throw new ForbiddenException(
        'Authentication and organization context required'
      );
    }

    const result = await withSystemScope(
      (conn) => checkAdminAccess(conn, { userId, organizationId }),
      { db }
    );

    if (!result.success || !result.data.hasAccess) {
      this.logger.warn(
        `Admin access denied for user ${userId} in org ${organizationId}`
      );
      throw new ForbiddenException('Admin or owner role required');
    }

    return true;
  }
}
