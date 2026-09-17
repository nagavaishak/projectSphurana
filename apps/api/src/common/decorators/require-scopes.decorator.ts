import type { ApiScope } from '@borradh-workspace/features/api-keys';
import { SetMetadata } from '@nestjs/common';

export const REQUIRED_SCOPES_KEY = 'requiredScopes';

/**
 * Decorator to specify required API scopes for an endpoint.
 * Must be used with ApiKeyGuard + ScopeGuard.
 *
 * @example
 * ```typescript
 * @Get()
 * @RequireScopes('leads:read')
 * async findAll() { ... }
 * ```
 */
export const RequireScopes = (...scopes: ApiScope[]) =>
  SetMetadata(REQUIRED_SCOPES_KEY, scopes);
