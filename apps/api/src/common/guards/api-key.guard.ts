import { auth } from '@borradh-workspace/auth/server';
import {
  type ApiKeyMetadata,
  verifyApiKey,
} from '@borradh-workspace/features/auth';
import { ErrorCodes } from '@borradh-workspace/features/shared';
import {
  type CanActivate,
  type ExecutionContext,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request } from 'express';

/**
 * Extended Request type with organization from API key
 */
export interface ApiKeyAuthenticatedRequest extends Request {
  organization: {
    id: string;
    name: string;
    slug: string;
  };
  apiKeyId: string;
  apiKeyScopes: string[];
}

/**
 * API Key Guard - Validates API key using better-auth apiKey plugin
 *
 * This guard:
 * 1. Extracts API key from X-API-Key header
 * 2. Validates the API key using better-auth (includes rate limiting)
 * 3. Extracts organization info from key metadata
 * 4. Attaches the organization object to the request
 *
 * Usage:
 * ```typescript
 * @UseGuards(ApiKeyGuard)
 * @Controller('integrations')
 * export class IntegrationsController {
 *   @Post('book')
 *   book(@ApiKeyOrganization() org: ApiKeyAuthenticatedRequest['organization']) {
 *     return { organizationId: org.id };
 *   }
 * }
 * ```
 */
@Injectable()
export class ApiKeyGuard implements CanActivate {
  private readonly logger = new Logger(ApiKeyGuard.name);

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context
      .switchToHttp()
      .getRequest<ApiKeyAuthenticatedRequest>();

    const apiKey = this.extractApiKey(request);
    if (!apiKey) {
      this.logger.warn('API key missing from request');
      throw new UnauthorizedException('API key required');
    }

    // Verify API key using feature service
    const result = await verifyApiKey(auth.api, { key: apiKey });

    if (!result.success) {
      if (result.error.code === ErrorCodes.RATE_LIMITED) {
        throw new HttpException(
          'Rate limit exceeded',
          HttpStatus.TOO_MANY_REQUESTS
        );
      }
      this.logger.warn('Invalid API key provided');
      throw new UnauthorizedException(result.error.message);
    }

    // Extract organization info from metadata
    const metadata = result.data.key.metadata as ApiKeyMetadata | null;
    if (!metadata?.organizationId) {
      this.logger.warn('API key missing organization metadata');
      throw new UnauthorizedException('Invalid API key configuration');
    }

    // Attach organization and scopes to request
    request.organization = {
      id: metadata.organizationId,
      name: metadata.organizationName,
      slug: metadata.organizationSlug,
    };
    request.apiKeyId = result.data.key.id;
    request.apiKeyScopes = metadata.scopes ?? [];

    this.logger.log(
      `API key authenticated for organization: ${metadata.organizationId}`
    );
    return true;
  }

  /**
   * Extract API key from X-API-Key header
   */
  private extractApiKey(request: Request): string | null {
    const apiKey = request.headers['x-api-key'];
    if (typeof apiKey === 'string') {
      return apiKey;
    }
    if (Array.isArray(apiKey) && apiKey.length > 0) {
      return apiKey[0];
    }
    return null;
  }
}
