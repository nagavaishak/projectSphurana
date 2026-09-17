import { db, withSystemScope } from '@borradh-workspace/database';
import { checkMemberAccess } from '@borradh-workspace/features/organizations';
import { type ExecutionContext, createParamDecorator } from '@nestjs/common';
import type { AuthenticatedRequest } from '../guards/auth.guard.js';
import { type Role, hasMinimumRole } from '../guards/permissions.js';

/**
 * Whether the caller may act on OTHER people's records in the active org —
 * true for `admin`/`owner`, false for a plain `member` (who may only touch the
 * practitioner linked to their own user) and false when the membership cannot
 * be read at all.
 *
 * Was `TimesheetsController.canManageOthers`, awaited at the top of the
 * clock-in / clock-out handlers and passed straight into the use case. It is a
 * value DERIVED FROM THE REQUEST, which is a param decorator's job (Gate 5) —
 * not a Guard, because the use case needs the boolean rather than a yes/no
 * admission: a member clocking THEMSELVES in is allowed and must not 403.
 *
 * The membership read is deliberately `withSystemScope`: role resolution has to
 * see the membership row before RLS has anything to scope by.
 */
export const CanManageOthers = createParamDecorator(
  async (_data: unknown, ctx: ExecutionContext): Promise<boolean> => {
    const request = ctx.switchToHttp().getRequest<AuthenticatedRequest>();
    const userId = request.user?.id as string;
    const organizationId = request.activeOrganizationId as string;

    const access = await withSystemScope(
      (conn) => checkMemberAccess(conn, { userId, organizationId }),
      { db }
    );
    const role = (access.success ? access.data.role : null) as Role | null;
    return role ? hasMinimumRole(role, 'admin') : false;
  }
);
