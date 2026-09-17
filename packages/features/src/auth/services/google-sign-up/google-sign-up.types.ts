/**
 * Google sign-up response - returns the redirect URL for OAuth flow
 */
export interface GoogleSignUpResponse {
  url: string;
  redirect: boolean;
}

/**
 * Auth API interface for Google sign-up
 */
export interface GoogleSignUpAuthApi {
  signInSocial: (options: {
    body: {
      provider: 'google';
      callbackURL?: string;
      errorCallbackURL?: string;
      newUserCallbackURL?: string;
    };
    asResponse: true;
  }) => Promise<Response>;
}
