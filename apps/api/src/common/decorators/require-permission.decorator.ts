import { SetMetadata } from '@nestjs/common';

export const REQUIRE_PERMISSION_KEY = 'requirePermission';

/**
 * Decorator to require a specific permission on a controller method or class.
 * Must be used with RoleGuard.
 *
 * @example
 * ```typescript
 * @RequirePermission('appointments:manage')
 * @Post()
 * async create() { ... }
 * ```
 */
export const RequirePermission = (permission: string) =>
  SetMetadata(REQUIRE_PERMISSION_KEY, permission);
