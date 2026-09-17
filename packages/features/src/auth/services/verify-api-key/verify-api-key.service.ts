import { logError, trackedResult } from '@borradh-workspace/observability';
import { ErrorCodes, FeatureError, err, ok } from '../../../shared/index.js';
import type { ApiKeyMetadata } from '../create-api-key/create-api-key.types.js';
import {
  type VerifyApiKeyInput,
  verifyApiKeySchema,
} from './verify-api-key.schema.js';
import type {
  VerifyApiKeyAuthApi,
  VerifyApiKeyResponse,
} from './verify-api-key.types.js';

// Re-export types
export type {
  VerifyApiKeyResponse,
  VerifyApiKeyAuthApi,
} from './verify-api-key.types.js';

/**
 * Internal implementation of verify API key
 */
const verifyApiKeyImpl = async (
  authApi: VerifyApiKeyAuthApi,
  input: VerifyApiKeyInput
) => {
  // Validate input
  const parsed = verifyApiKeySchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  try {
    // Call Better Auth API with asResponse: true
    const response = await authApi.verifyApiKey({
      body: {
        key: parsed.data.key,
      },
      asResponse: true,
    });

    // Parse the response
    const result = (await response.json()) as {
      valid: boolean;
      error?: { message: string; code: string } | null;
      key?: {
        id: string;
        name: string | null;
        userId: string;
        metadata: Record<string, unknown> | null;
        expiresAt: Date | null;
        enabled: boolean;
      } | null;
    };

    if (!result.valid || !result.key) {
      const errorMessage = result.error?.message || 'Invalid API key';
      const errorCode = result.error?.code;

      if (errorCode === 'RATE_LIMITED') {
        return err(new FeatureError(ErrorCodes.RATE_LIMITED, errorMessage));
      }

      return err(new FeatureError(ErrorCodes.UNAUTHORIZED, errorMessage));
    }

    return ok({
      valid: true,
      key: {
        id: result.key.id,
        name: result.key.name,
        userId: result.key.userId,
        metadata: result.key.metadata as ApiKeyMetadata | null,
        expiresAt: result.key.expiresAt,
        enabled: result.key.enabled,
      },
    } as VerifyApiKeyResponse);
  } catch (error) {
    logError('auth.verifyApiKey', error, { feature: 'auth' });
    return err(
      new FeatureError(
        ErrorCodes.INTERNAL_ERROR,
        'Failed to verify API key',
        undefined,
        error instanceof Error ? error : undefined
      )
    );
  }
};

/**
 * Verify an API key
 *
 * @param authApi - Auth API instance (e.g., auth.api from Better Auth)
 * @param input - Verify API key input
 * @returns Result with key details if valid
 *
 * @example
 * ```ts
 * import { auth } from '@borradh-workspace/auth/server';
 *
 * const result = await verifyApiKey(auth.api, {
 *   key: 'org_my-org_abc123...',
 * });
 *
 * if (result.success) {
 *   console.log('Organization:', result.data.key.metadata?.organizationId);
 * } else {
 *   console.error('Invalid key:', result.error.message);
 * }
 * ```
 */
export const verifyApiKey = (
  authApi: VerifyApiKeyAuthApi,
  input: VerifyApiKeyInput
) =>
  trackedResult('auth.verifyApiKey', () => verifyApiKeyImpl(authApi, input), {
    properties: { hasKey: !!input.key },
    internalErrorsOnly: true,
  });

/**
 * Result type for verifyApiKey
 */
export type VerifyApiKeyResult = Awaited<ReturnType<typeof verifyApiKey>>;
