import {
  type CanActivate,
  type ExecutionContext,
  HttpException,
  HttpStatus,
  Injectable,
} from '@nestjs/common';
import type { Request } from 'express';
import type { AuthenticatedRequest } from './auth.guard';

/**
 * `:id` in the path MUST be the caller's active organization.
 *
 * This was `OrganizationsController.assertOrgAccess`, called as the first line
 * of six handlers. It is the IDOR check for the whole `/organizations/:id/*`
 * surface: `MemberGuard` proves you belong to your ACTIVE org, and this proves
 * the org you are asking about IS that org. Without it, a member of org B can
 * read org A's members simply by putting A's id in the URL.
 *
 * A first-line call is exactly the wrong shape for that: the seventh handler
 * anyone adds to this controller inherits the vulnerability by omission, and
 * nothing fails. As a decorator it sits in the route declaration next to
 * `@MemberGuard`, where its absence is visible.
 *
 * ORDER: register it AFTER MemberGuard / AdminGuard in `@UseGuards(...)`. Nest
 * runs controller-level guards then method-level guards left to right, so that
 * reproduces the original sequence (membership → role → scope) and therefore
 * the original status code when more than one would reject.
 *
 * The 403 is constructed exactly as before — `HttpException('Forbidden', 403)`.
 */
@Injectable()
export class ActiveOrgParamGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context
      .switchToHttp()
      .getRequest<AuthenticatedRequest & Request>();

    const requestedOrgId = request.params?.id;
    const activeOrgId = request.activeOrganizationId;

    if (!activeOrgId || requestedOrgId !== activeOrgId) {
      throw new HttpException('Forbidden', HttpStatus.FORBIDDEN);
    }
    return true;
  }
}
