import { type ExecutionContext, createParamDecorator } from '@nestjs/common';
import type { AuthenticatedRequest } from '../guards/auth.guard';

/**
 * ActiveLocation Decorator — the branch this request is scoped to.
 *
 * Reads the value `LocationGuard` already validated against the active
 * organization; this decorator does NO checking of its own, exactly as
 * `@ActiveOrganization()` does no session lookup of its own.
 *
 * `undefined` means "no branch selected" and MUST be treated as org-wide, not
 * as "show nothing". Two callers rely on that: any client that has not adopted
 * the `X-Location-Id` header yet, and every genuinely org-level endpoint.
 *
 * Usage:
 * ```typescript
 * @Get()
 * findAll(
 *   @ActiveOrganization() organizationId: string,
 *   @ActiveLocation() locationId: string | undefined,
 * ) {
 *   return listThings(db, { organizationId, locationId });
 * }
 * ```
 */
export const ActiveLocation = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext) => {
    const request = ctx.switchToHttp().getRequest<AuthenticatedRequest>();
    return request.activeLocationId;
  }
);
