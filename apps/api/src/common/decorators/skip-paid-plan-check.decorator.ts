import { SetMetadata } from '@nestjs/common';

export const SKIP_PAID_PLAN_CHECK_KEY = 'skipPaidPlanCheck';

/**
 * Decorator to skip the global paid plan check for a controller or method.
 * Use on controllers that must remain accessible regardless of subscription status
 * (e.g., billing, account management, org switching).
 *
 * @example
 * ```typescript
 * @Controller('billing')
 * @SkipPaidPlanCheck()
 * export class BillingController { ... }
 * ```
 */
export const SkipPaidPlanCheck = () =>
  SetMetadata(SKIP_PAID_PLAN_CHECK_KEY, true);
