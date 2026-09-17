/**
 * Sign-out response - shared types for both server and client
 */
export interface SignOutResponse {
  success: boolean;
}

/**
 * Auth API interface for sign-out - used by server-side services
 */
export interface SignOutAuthApi {
  signOut: (options: {
    headers: { authorization: string };
    asResponse: true;
  }) => Promise<Response>;
}
