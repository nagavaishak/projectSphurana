import { logError, trackedResult } from '@borradh-workspace/observability';
import { ErrorCodes, FeatureError, err, ok } from '../../../shared/index.js';
import {
  type CreateApiKeyInput,
  createApiKeySchema,
} from './create-api-key.schema.js';
import type {
  ApiKeyMetadata,
  CreateApiKeyAuthApi,
  CreateApiKeyResponse,
} from './create-api-key.types.js';

// Re-export types
export type {
  CreateApiKeyResponse,
  CreateApiKeyAuthApi,
  ApiKeyMetadata,
} from './create-api-key.types.js';

/**
 * Internal implementation of create API key
 */
const createApiKeyImpl = async (
  authApi: CreateApiKeyAuthApi,
  input: CreateApiKeyInput
) => {
  // Validate input
  const parsed = createApiKeySchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  const {
    userId,
    organizationId,
    organizationName,
    organizationSlug,
    name,
    expiresInDays,
  } = parsed.data;

  try {
    const scopes = parsed.data.scopes ?? [];
    const rateLimitMax = parsed.data.rateLimitMax ?? 1000;

    const result = await authApi.createApiKey({
      body: {
        name: name || `${organizationSlug}-api-key`,
        userId,
        expiresIn: expiresInDays * 24 * 60 * 60 * 1000, // Convert days to ms
        prefix: `org_${organizationSlug}_`,
        metadata: {
          organizationId,
          organizationName,
          organizationSlug,
          scopes,
        } satisfies ApiKeyMetadata,
        permissions: scopes.length > 0 ? { api: scopes } : undefined,
        rateLimitEnabled: true,
        rateLimitMax,
        rateLimitTimeWindow: 60 * 60 * 1000, // 1 hour
      },
    });

    return ok({
      id: result.id,
      key: result.key,
      name: result.name,
      expiresAt: result.expiresAt,
      prefix: result.prefix,
    } as CreateApiKeyResponse);
  } catch (error) {
    // Handle specific errors
    if (error instanceof Error) {
      if (
        error.message.includes('unauthorized') ||
        error.message.includes('Unauthorized')
      ) {
        return err(
          new FeatureError(
            ErrorCodes.UNAUTHORIZED,
            'Not authorized to create API key'
          )
        );
      }
    }

    logError('auth.createApiKey', error, {
      feature: 'auth',
      extra: { organizationId },
    });
    return err(
      new FeatureError(
        ErrorCodes.INTERNAL_ERROR,
        'Failed to create API key',
        undefined,
        error instanceof Error ? error : undefined
      )
    );
  }
};

/**
 * Create an API key for an organization
 *
 * @param authApi - Auth API instance (e.g., auth.api from Better Auth)
 * @param input - Create API key input
 * @returns Result with the created API key (key is only returned once!)
 *
 * @example
 * ```ts
 * import { auth } from '@borradh-workspace/auth/server';
 *
 * const result = await createApiKey(auth.api, {
 *   userId: 'user-123',
 *   organizationId: 'org-456',
 *   organizationName: 'My Org',
 *   organizationSlug: 'my-org',
 *   name: 'Production API Key',
 * });
 *
 * if (result.success) {
 *   // Store result.data.key securely - it won't be shown again!
 *   console.log('API Key:', result.data.key);
 * }
 * ```
 */
export const createApiKey = (
  authApi: CreateApiKeyAuthApi,
  input: CreateApiKeyInput
) =>
  trackedResult('auth.createApiKey', () => createApiKeyImpl(authApi, input), {
    properties: { organizationId: input.organizationId },
  });

/**
 * Result type for createApiKey
 */
export type CreateApiKeyResult = Awaited<ReturnType<typeof createApiKey>>;
