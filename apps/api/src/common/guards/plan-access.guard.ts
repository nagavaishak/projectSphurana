import { db } from '@borradh-workspace/database';
import { getPlanApiLimits } from '@borradh-workspace/features/api-keys';
import { getSubscription } from '@borradh-workspace/features/billing';
import {
  type CanActivate,
  type ExecutionContext,
  ForbiddenException,
  Injectable,
  Logger,
} from '@nestjs/common';
import type { ApiKeyAuthenticatedRequest } from './api-key.guard';

/**
 * Guard that checks if the organization's plan allows API access.
 * Must be used after ApiKeyGuard (which attaches organization to the request).
 */
@Injectable()
export class PlanAccessGuard implements CanActivate {
  private readonly logger = new Logger(PlanAccessGuard.name);

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context
      .switchToHttp()
      .getRequest<ApiKeyAuthenticatedRequest>();

    const organizationId = request.organization?.id;
    if (!organizationId) {
      throw new ForbiddenException('Organization context required');
    }

    const result = await getSubscription(db, { organizationId });
    if (!result.success) {
      // No subscription found - default to no API access
      this.logger.warn(
        `No subscription found for org ${organizationId}, denying API access`
      );
      throw new ForbiddenException('API access requires a paid plan');
    }

    const limits = getPlanApiLimits(result.data.planId);
    if (!limits.hasApiAccess) {
      throw new ForbiddenException('API access requires a paid plan');
    }

    return true;
  }
}
