import { and, db, eq, member } from '@borradh-workspace/database';
import {
  type CanActivate,
  type ExecutionContext,
  ForbiddenException,
  Injectable,
  Logger,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { REQUIRE_PERMISSION_KEY } from '../decorators/require-permission.decorator.js';
import { REQUIRE_ROLE_KEY } from '../decorators/require-role.decorator.js';
import type { AuthenticatedRequest } from './auth.guard.js';
import { type Role, hasMinimumRole, hasPermission } from './permissions.js';

/**
 * Guard that checks role and permission requirements on controller methods.
 * Reads metadata set by @RequireRole() and @RequirePermission() decorators.
 *
 * Must be used after AuthGuard (which attaches user and activeOrganizationId).
 *
 * If neither @RequireRole nor @RequirePermission is set, the guard passes through.
 *
 * @example
 * ```typescript
 * @Controller('practitioners')
 * @UseGuards(AuthGuard, RoleGuard)
 * export class PractitionersController {
 *   @Post()
 *   @RequireRole('owner')
 *   async create() { ... }
 *
 *   @Get()
 *   async list() { ... } // No decorator = any authenticated member can access
 * }
 * ```
 */
@Injectable()
export class RoleGuard implements CanActivate {
  private readonly logger = new Logger(RoleGuard.name);

  constructor(private readonly reflector: Reflector) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const requiredRole = this.reflector.getAllAndOverride<string | undefined>(
      REQUIRE_ROLE_KEY,
      [context.getHandler(), context.getClass()]
    );
    const requiredPermission = this.reflector.getAllAndOverride<
      string | undefined
    >(REQUIRE_PERMISSION_KEY, [context.getHandler(), context.getClass()]);

    // No role or permission metadata set — passthrough
    if (!requiredRole && !requiredPermission) return true;

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const userId = request.user?.id;
    const organizationId = request.activeOrganizationId;

    if (!userId || !organizationId) {
      throw new ForbiddenException(
        'Authentication and organization context required'
      );
    }

    const memberRecord = await db.query.member.findFirst({
      where: and(
        eq(member.userId, userId),
        eq(member.organizationId, organizationId)
      ),
    });

    if (!memberRecord) {
      throw new ForbiddenException('Not a member of this organization');
    }

    const userRole = (memberRecord.role || 'member') as Role;

    if (requiredRole && !hasMinimumRole(userRole, requiredRole as Role)) {
      this.logger.warn(
        `Role check failed: user=${userId} role=${userRole} required=${requiredRole}`
      );
      throw new ForbiddenException(`${requiredRole} role or higher required`);
    }

    if (requiredPermission && !hasPermission(userRole, requiredPermission)) {
      this.logger.warn(
        `Permission check failed: user=${userId} role=${userRole} permission=${requiredPermission}`
      );
      throw new ForbiddenException(
        `Permission '${requiredPermission}' required`
      );
    }

    return true;
  }
}
