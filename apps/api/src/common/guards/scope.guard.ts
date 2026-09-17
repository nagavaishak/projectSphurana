import {
  type ApiScope,
  getMissingScopes,
} from '@borradh-workspace/features/api-keys';
import {
  type CanActivate,
  type ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { REQUIRED_SCOPES_KEY } from '../decorators/require-scopes.decorator';
import type { ApiKeyAuthenticatedRequest } from './api-key.guard';

/**
 * Guard that checks if the API key has the required scopes.
 * Must be used after ApiKeyGuard (which attaches apiKeyScopes to the request).
 */
@Injectable()
export class ScopeGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredScopes = this.reflector.getAllAndOverride<
      ApiScope[] | undefined
    >(REQUIRED_SCOPES_KEY, [context.getHandler(), context.getClass()]);

    // If no scopes are required, allow access
    if (!requiredScopes || requiredScopes.length === 0) {
      return true;
    }

    const request = context
      .switchToHttp()
      .getRequest<ApiKeyAuthenticatedRequest>();
    const grantedScopes = request.apiKeyScopes ?? [];

    const missing = getMissingScopes(grantedScopes, requiredScopes);
    if (missing.length > 0) {
      throw new ForbiddenException(
        `Missing required scopes: ${missing.join(', ')}`
      );
    }

    return true;
  }
}
