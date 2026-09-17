import { type ExecutionContext, createParamDecorator } from '@nestjs/common';
import type { AuthenticatedRequest } from '../guards/auth.guard';

/**
 * ActiveOrganization Decorator - Extracts the active organization ID from the request
 *
 * Use with AuthGuard to get the user's active organization in controller methods.
 * Returns undefined if no organization is active.
 *
 * Usage:
 * ```typescript
 * @UseGuards(AuthGuard)
 * @Get('org-resource')
 * getOrgResource(@ActiveOrganization() organizationId: string | undefined) {
 *   if (!organizationId) {
 *     throw new BadRequestException('No active organization selected');
 *   }
 *   return { organizationId };
 * }
 * ```
 */
export const ActiveOrganization = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext) => {
    const request = ctx.switchToHttp().getRequest<AuthenticatedRequest>();
    return request.activeOrganizationId;
  }
);
