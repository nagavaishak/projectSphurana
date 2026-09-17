import type { Auth } from '@borradh-workspace/auth';

/**
 * Session response - inferred from Better Auth with asResponse: true
 */
export type SessionResponse = NonNullable<
  Awaited<ReturnType<Auth['api']['getSession']>>
>;

/**
 * Auth API interface for get-session - used by server-side services
 * Uses asResponse: true to get a Response object for proper header/cookie handling
 */
export type GetSessionAuthApi = {
  getSession: (options: {
    headers: Headers;
    asResponse: true;
  }) => Promise<Response>;
};
