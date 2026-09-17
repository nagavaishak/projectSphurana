import { API_SCOPES, apiScopeValues } from '@borradh-workspace/features/shared';
// Re-export scope constants for frontend use
export { API_SCOPES, apiScopeValues };

// Derive scope type from the source of truth
export type ApiScope = keyof typeof API_SCOPES;

/**
 * API key as returned by the list endpoint (key value is never exposed)
 */
export interface ApiKeyListItem {
  id: string;
  name: string | null;
  start: string | null;
  prefix: string | null;
  enabled: boolean;
  expiresAt: string | null;
  createdAt: string;
  lastRequest: string | null;
  scopes: string[];
  rateLimitMax: number | null;
}

/**
 * Response from listing API keys
 */
export interface ApiKeyListResponse {
  items: ApiKeyListItem[];
}

/**
 * Input for creating an API key
 */
export interface CreateApiKeyInput {
  name: string;
  scopes: ApiScope[];
  expiresInDays?: number;
}

/**
 * Response from creating an API key (key is shown ONCE)
 */
export interface CreateApiKeyResponse {
  id: string;
  key: string;
  name: string | null;
  expiresAt: string | null;
  prefix: string | null;
}

/**
 * Input for updating an API key
 */
export interface UpdateApiKeyInput {
  name?: string;
  enabled?: boolean;
}
