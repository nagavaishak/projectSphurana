/**
 * Sign-in response - shared types for both server and client
 *
 * When twoFactorRequired is true, user and session are absent.
 * The client should redirect to the 2FA verification page.
 */
export type SignInResponse =
  | {
      twoFactorRequired?: false;
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
  | {
      twoFactorRequired: true;
      /** Raw Set-Cookie headers from Better Auth (server-side only, not sent to client) */
      setCookieHeaders?: string[];
    };

/**
 * Auth API interface for sign-in - used by server-side services
 */
export interface SignInAuthApi {
  signInEmail: (options: {
    body: { email: string; password: string };
    asResponse: true;
  }) => Promise<Response>;
}
