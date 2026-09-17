import { SetMetadata } from '@nestjs/common';

export const REQUIRE_ROLE_KEY = 'requireRole';

/**
 * Decorator to require a minimum role level on a controller method or class.
 * Must be used with RoleGuard.
 *
 * @example
 * ```typescript
 * @RequireRole('admin')
 * @Post()
 * async create() { ... }
 * ```
 */
export const RequireRole = (role: string) =>
  SetMetadata(REQUIRE_ROLE_KEY, role);
