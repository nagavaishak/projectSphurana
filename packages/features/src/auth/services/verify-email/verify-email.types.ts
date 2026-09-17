/**
 * Verify email response - shared types for both server and client
 */
export interface VerifyEmailResponse {
  user: {
    id: string;
    email: string;
    name: string;
    emailVerified: boolean;
  } | null;
  /** Session token when autoSignInAfterVerification is enabled */
  sessionToken?: string;
}

/**
 * Auth API interface for verify email - used by server-side services
 */
export interface VerifyEmailAuthApi {
  verifyEmail: (options: {
    query: { token: string };
    asResponse: true;
  }) => Promise<Response>;
}
