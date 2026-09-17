import type { ApiKeyMetadata } from '../create-api-key/create-api-key.types.js';

/**
 * Response from verifying an API key
 */
export interface VerifyApiKeyResponse {
  /** Whether the key is valid */
  valid: boolean;
  /** The API key details (without the actual key) */
  key: {
    id: string;
    name: string | null;
    userId: string;
    metadata: ApiKeyMetadata | null;
    expiresAt: Date | null;
    enabled: boolean;
  };
}

/**
 * Auth API interface for verifying API keys
 * Uses asResponse: true to work with better-auth's strict endpoint typing
 */
export interface VerifyApiKeyAuthApi {
  verifyApiKey: (options: {
    body: {
      key: string;
      permissions?: Record<string, string[]>;
    };
    asResponse: true;
  }) => Promise<Response>;
}
