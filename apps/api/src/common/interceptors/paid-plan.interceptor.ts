import { db } from '@borradh-workspace/database';
import { getSubscription } from '@borradh-workspace/features/billing';
import { isOrgOnboarding } from '@borradh-workspace/features/onboarding';
import {
  type CallHandler,
  type ExecutionContext,
  ForbiddenException,
  Injectable,
  Logger,
  type NestInterceptor,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Observable } from 'rxjs';
import { SKIP_PAID_PLAN_CHECK_KEY } from '../decorators/skip-paid-plan-check.decorator';
import type { AuthenticatedRequest } from '../guards/auth.guard';

const ACTIVE_STATUSES = new Set(['active', 'trialing']);

/**
 * Global interceptor that enforces paid plan requirements.
 *
 * Runs AFTER guards (so request.user and request.activeOrganizationId are available).
 * Auto-skips when:
 * - `@SkipPaidPlanCheck()` is present on the class or method
 * - No `request.user` (unauthenticated route)
 * - No `request.activeOrganizationId` (no org context)
 *
 * Register as APP_INTERCEPTOR in AppModule AFTER RlsInterceptor: getSubscription
 * is withOrgScope-wrapped and needs the RLS context established by RlsInterceptor.
 */
@Injectable()
export class PaidPlanInterceptor implements NestInterceptor {
  private readonly logger = new Logger(PaidPlanInterceptor.name);

  constructor(private readonly reflector: Reflector) {}

  async intercept(
    context: ExecutionContext,
    next: CallHandler
  ): Promise<Observable<unknown>> {
    // Check for @SkipPaidPlanCheck() on method or class
    const skip = this.reflector.getAllAndOverride<boolean>(
      SKIP_PAID_PLAN_CHECK_KEY,
      [context.getHandler(), context.getClass()]
    );
    if (skip) {
      return next.handle();
    }

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();

    // Skip for unauthenticated routes (AuthGuard didn't run)
    if (!request.user) {
      return next.handle();
    }

    // Skip for impersonated sessions — admins need full access to debug
    if (request.impersonatedBy) {
      return next.handle();
    }

    // Skip for routes without org context (org selection, V1 API key routes, etc.)
    if (!request.activeOrganizationId) {
      return next.handle();
    }

    const organizationId = request.activeOrganizationId;
    const result = await getSubscription(db, { organizationId });

    const subscriptionActive =
      result.success && ACTIVE_STATUSES.has(result.data.status);
    if (subscriptionActive) {
      return next.handle();
    }

    // No active subscription — but the whole onboarding flow runs before
    // billing, so an org still mid-onboarding is treated as a free trial.
    if (await isOrgOnboarding(db, organizationId)) {
      return next.handle();
    }

    this.logger.warn(
      result.success
        ? `Subscription status "${result.data.status}" for org ${organizationId} is not active`
        : `No subscription found for org ${organizationId}, denying access`
    );
    throw new ForbiddenException('A paid plan is required for this action');
  }
}
