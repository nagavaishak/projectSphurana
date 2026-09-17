/**
 * API Key metadata stored with the key
 */
export interface ApiKeyMetadata {
  organizationId: string;
  organizationName: string;
  organizationSlug: string;
  scopes?: string[];
}

/**
 * Response from creating an API key
 */
export interface CreateApiKeyResponse {
  /** The API key ID (for management) */
  id: string;
  /** The full API key (only returned once, not stored) */
  key: string;
  /** Name of the key */
  name: string | null;
  /** When the key expires */
  expiresAt: Date | null;
  /** Key prefix for identification */
  prefix: string | null;
}

/**
 * Auth API interface for creating API keys
 */
export interface CreateApiKeyAuthApi {
  createApiKey: (options: {
    body: {
      name?: string;
      userId: string;
      expiresIn?: number;
      prefix?: string;
      metadata?: Record<string, unknown>;
      permissions?: Record<string, string[]>;
      rateLimitEnabled?: boolean;
      rateLimitMax?: number;
      rateLimitTimeWindow?: number;
    };
  }) => Promise<{
    id: string;
    key: string;
    name: string | null;
    expiresAt: Date | null;
    prefix: string | null;
  }>;
}
