import { db } from '@borradh-workspace/database';
import { getSubscription } from '@borradh-workspace/features/billing';
import {
  type CanActivate,
  type ExecutionContext,
  ForbiddenException,
  Injectable,
  Logger,
} from '@nestjs/common';
import type { AuthenticatedRequest } from './auth.guard';

const ACTIVE_STATUSES = new Set(['active', 'trialing']);

/**
 * Guard that checks if the organization has an active paid subscription.
 * Must be used after AuthGuard (which attaches activeOrganizationId to the request).
 *
 * This guard is for session-authenticated requests (AuthenticatedRequest).
 * For API key auth, use PlanAccessGuard instead.
 */
@Injectable()
export class PaidPlanGuard implements CanActivate {
  private readonly logger = new Logger(PaidPlanGuard.name);

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();

    // Skip billing check for impersonated sessions — admins need full access
    if (request.impersonatedBy) {
      return true;
    }

    const organizationId = request.activeOrganizationId;
    if (!organizationId) {
      throw new ForbiddenException('Organization context required');
    }

    const result = await getSubscription(db, { organizationId });

    if (!result.success) {
      this.logger.warn(
        `No subscription found for org ${organizationId}, denying access`
      );
      throw new ForbiddenException('A paid plan is required for this action');
    }

    if (!ACTIVE_STATUSES.has(result.data.status)) {
      this.logger.warn(
        `Subscription status "${result.data.status}" for org ${organizationId} is not active`
      );
      throw new ForbiddenException('A paid plan is required for this action');
    }

    return true;
  }
}
