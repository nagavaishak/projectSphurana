/**
 * Sign-up response - shared types for both server and client
 */
export interface SignUpResponse {
  user: {
    id: string;
    email: string;
    name: string;
    emailVerified: boolean;
    createdAt: Date;
    updatedAt: Date;
  };
  session: {
    token: string;
  };
}

/**
 * Auth API interface for sign-up - used by server-side services
 */
export interface SignUpAuthApi {
  signUpEmail: (options: {
    body: { email: string; password: string; name: string };
    asResponse: true;
  }) => Promise<Response>;
}
