/**
 * API scope definitions for the public API.
 *
 * Each scope grants access to specific resources and operations.
 * Scopes follow the pattern: `{resource}:{action}` where action is `read` or `write`.
 */
export const API_SCOPES = {
  'leads:read': 'View leads and lead stats',
  'leads:write': 'Create, update, and delete leads',
  'appointments:read': 'View appointments',
  'appointments:write': 'Create, update, and delete appointments',
  'lead-forms:read': 'View lead forms',
  'lead-forms:write': 'Create, update, and delete lead forms',
  'organization:read': 'View organization details, locations, and services',
  'social-posts:read': 'View social posts',
  'social-posts:write': 'Create, update, delete, and publish social posts',
  'assets:read': 'View assets',
  'assets:write': 'Create and delete assets',
} as const;

export type ApiScope = keyof typeof API_SCOPES;
export const apiScopeValues = Object.keys(API_SCOPES) as ApiScope[];

/**
 * Check if the granted scopes include all required scopes
 */
export function hasAllScopes(granted: string[], required: ApiScope[]): boolean {
  return required.every((s) => granted.includes(s));
}

/**
 * Get missing scopes that are required but not granted
 */
export function getMissingScopes(
  granted: string[],
  required: ApiScope[]
): ApiScope[] {
  return required.filter((s) => !granted.includes(s));
}

/**
 * Validate that all provided scopes are valid API scopes
 */
export function areValidScopes(scopes: string[]): scopes is ApiScope[] {
  return scopes.every((s) => s in API_SCOPES);
}
