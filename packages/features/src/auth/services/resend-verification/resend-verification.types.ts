/**
 * Resend verification response - shared types for both server and client
 */
export interface ResendVerificationResponse {
  success: boolean;
  message: string;
}

/**
 * Auth API interface for resend verification - used by server-side services
 */
export interface ResendVerificationAuthApi {
  sendVerificationEmail: (options: {
    body: { email: string; callbackURL?: string };
    asResponse: true;
  }) => Promise<Response>;
}
