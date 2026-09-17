import { type ExecutionContext, createParamDecorator } from '@nestjs/common';
import type { ApiKeyAuthenticatedRequest } from '../guards/api-key.guard';

/**
 * Parameter decorator to extract the organization from API key authenticated requests
 *
 * Usage:
 * ```typescript
 * @Get()
 * async getData(@ApiKeyOrganization() org: ApiKeyAuthenticatedRequest['organization']) {
 *   return { organizationId: org.id };
 * }
 *
 * // Or just get the ID
 * @Get()
 * async getData(@ApiKeyOrganization('id') orgId: string) {
 *   return { organizationId: orgId };
 * }
 * ```
 */
export const ApiKeyOrganization = createParamDecorator(
  (
    data: keyof ApiKeyAuthenticatedRequest['organization'] | undefined,
    ctx: ExecutionContext
  ) => {
    const request = ctx.switchToHttp().getRequest<ApiKeyAuthenticatedRequest>();
    const organization = request.organization;

    if (!organization) {
      return null;
    }

    return data ? organization[data] : organization;
  }
);
